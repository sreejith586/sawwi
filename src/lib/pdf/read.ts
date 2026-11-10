import type { PdfPage, TextItem } from "./types";

// pdf.js (pure JS, no native binary) in Node: text with positions, attachments, QR
// images decoded with jsQR, and scanned page images for OCR (decoded by pdf.js itself). Pages are never rendered, so the optional canvas package
// pdf.js would use for rendering isn't installed (see pnpm-workspace.yaml).

export const MAX_PAGES = 200;

export class PdfInputError extends Error {}

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsPromise: Promise<PdfJs> | undefined;

/** Loads pdf.js once, muting its load-time warnings about the canvas polyfills we don't need. */
function pdfjs(): Promise<PdfJs> {
  pdfjsPromise ??= (async () => {
    const warn = console.warn;
    const log = console.log;
    const quiet = (fn: typeof console.warn) => (...args: unknown[]) => {
      if (/napi-rs\/canvas|polyfill|DOMMatrix|Path2D|ImageData/i.test(String(args[0]))) return;
      fn(...args);
    };
    console.warn = quiet(warn);
    console.log = quiet(log);
    try {
      // On Node, pdf.js runs its worker on the main thread and finds it with `import(workerSrc)`, a
      // runtime path that Vercel's file tracing can't follow: pdf.worker.mjs was left out of the
      // deployment and every PDF failed to open in production. A literal import gets the file traced;
      // `globalThis.pdfjsWorker` is where pdf.js looks for an already-loaded worker before importing one.
      const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
      (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
      return await import("pdfjs-dist/legacy/build/pdf.mjs");
    } finally {
      console.warn = warn;
      console.log = log;
    }
  })();
  return pdfjsPromise;
}

export type LoadedPdf = {
  numPages: number;
  pages: PdfPage[];
  attachments: { name: string; bytes: Uint8Array }[];
  /** Counts images on the given pages (used to tell scanned PDFs from empty ones). */
  imageCount(pages: number[]): Promise<number>;
  /** Decodes QR codes drawn as images on the given pages. */
  qrCodes(pages: number[]): Promise<string[]>;
  /** The largest image on each page, as RGBA: the scan itself on an image-only page. */
  pageImages(pages: number[]): Promise<PageImage[]>;
  close(): Promise<void>;
};

export type PageImage = { page: number; pageWidth: number; pageHeight: number; width: number; height: number; rgba: Uint8ClampedArray };

export async function loadPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  const lib = await pdfjs();
  let doc: Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;
  let task: ReturnType<PdfJs["getDocument"]> | undefined;
  try {
    task = lib.getDocument({
      // pdf.js may detach the buffer it's given; keep the caller's bytes intact.
      data: bytes.slice(),
      verbosity: lib.VerbosityLevel.ERRORS,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      stopAtErrors: false,
    });
    doc = await task.promise;
  } catch (error) {
    await task?.destroy();
    const name = (error as { name?: string }).name;
    if (name === "PasswordException") {
      throw new PdfInputError("This PDF is password-protected. Open it, save or print a copy without the password, and upload that.");
    }
    if (name === "InvalidPDFException") throw new PdfInputError("This file isn't a readable PDF. Check it opens on your computer, or export the data as CSV/Excel.");
    // The user sees a generic message; keep the real cause in the server logs.
    console.error("pdf.js could not open a PDF:", error);
    throw new PdfInputError("Sawwi couldn't open this PDF. Export it as CSV/Excel, or try saving it again as PDF.");
  }

  if (doc.numPages > MAX_PAGES) {
    await task.destroy();
    throw new PdfInputError(`This PDF has ${doc.numPages} pages. Sawwi reads up to ${MAX_PAGES}: split it, or export a shorter period.`);
  }

  const pages: PdfPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: TextItem[] = [];
    for (const raw of content.items) {
      if (!("str" in raw) || !raw.str.trim()) continue;
      // Into viewport space: top-left origin, rotation applied.
      const [a, b, , , e, f] = lib.Util.transform(viewport.transform, raw.transform);
      const size = Math.hypot(a, b) || raw.height || 8;
      items.push({ str: raw.str, x: e, y: f, w: raw.width, h: size, page: n, rtl: raw.dir === "rtl" });
    }
    pages.push({ number: n, width: viewport.width, height: viewport.height, items, images: 0 });
  }

  const attachments: LoadedPdf["attachments"] = [];
  try {
    const found = await doc.getAttachments();
    for (const [id, meta] of found ?? []) {
      const data = await doc.getAttachmentContent(id);
      if (data) attachments.push({ name: meta.filename || id, bytes: data });
    }
  } catch {
    // A broken attachment table shouldn't stop the text layer from being read.
  }

  async function images(pageNumbers: number[]) {
    const out: { page: number; width: number; height: number; kind: number; data: Uint8Array }[] = [];
    let count = 0;
    for (const n of pageNumbers) {
      if (n < 1 || n > doc.numPages) continue;
      const page = await doc.getPage(n);
      const ops = await page.getOperatorList();
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        if (fn !== lib.OPS.paintImageXObject && fn !== lib.OPS.paintInlineImageXObject && fn !== lib.OPS.paintImageMaskXObject) continue;
        count++;
        const arg = ops.argsArray[i][0];
        const img =
          typeof arg === "string"
            ? await new Promise<unknown>((resolve) => {
                const objs = arg.startsWith("g_") ? page.commonObjs : page.objs;
                objs.get(arg, resolve);
              })
            : arg;
        const data = img as { width?: number; height?: number; kind?: number; data?: Uint8Array };
        if (data?.data && data.width && data.height) out.push({ page: n, width: data.width, height: data.height, kind: data.kind ?? 0, data: data.data });
      }
    }
    return { count, images: out };
  }

  return {
    numPages: doc.numPages,
    pages,
    attachments,
    imageCount: async (n) => (await images(n)).count,
    qrCodes: async (n) => {
      const { default: jsQR } = await import("jsqr");
      const codes: string[] = [];
      for (const img of (await images(n)).images) {
        const rgba = toRgba(img);
        if (!rgba) continue;
        const hit = jsQR(rgba, img.width, img.height, { inversionAttempts: "attemptBoth" });
        if (hit?.data) codes.push(hit.data);
      }
      return codes;
    },
    pageImages: async (n) => {
      const out: PageImage[] = [];
      const all = (await images(n)).images;
      for (const pageNumber of n) {
        const biggest = all.filter((i) => i.page === pageNumber).sort((a, b) => b.width * b.height - a.width * a.height)[0];
        const rgba = biggest && toRgba(biggest, 40_000_000);
        const page = pages[pageNumber - 1];
        if (biggest && rgba && page) out.push({ page: pageNumber, pageWidth: page.width, pageHeight: page.height, width: biggest.width, height: biggest.height, rgba });
      }
      return out;
    },
    close: () => task!.destroy(),
  };
}

/** pdf.js image kinds: 1 = 1-bit grayscale, 2 = RGB, 3 = RGBA. */
function toRgba(img: { width: number; height: number; kind: number; data: Uint8Array }, maxPixels = 4_000_000): Uint8ClampedArray | undefined {
  const px = img.width * img.height;
  if (px > maxPixels) return undefined;
  const out = new Uint8ClampedArray(px * 4);
  if (img.kind === 3) out.set(img.data.subarray(0, px * 4));
  else if (img.kind === 2) {
    for (let i = 0, j = 0; i < px; i++, j += 3) {
      out[i * 4] = img.data[j];
      out[i * 4 + 1] = img.data[j + 1];
      out[i * 4 + 2] = img.data[j + 2];
      out[i * 4 + 3] = 255;
    }
  } else if (img.kind === 1) {
    const rowBytes = (img.width + 7) >> 3;
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const bit = (img.data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const v = bit ? 255 : 0;
        const i = (y * img.width + x) * 4;
        out[i] = out[i + 1] = out[i + 2] = v;
        out[i + 3] = 255;
      }
  } else return undefined;
  return out;
}
