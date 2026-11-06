import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PageImage } from "./read";
import type { TextItem } from "./types";

// Local OCR for scanned PDFs (D-24): tesseract.js (WebAssembly) on the server, English and
// Arabic, with the language data from npm packages. Page images never leave the server.
// The words come back with positions and go through the same table reader as a text PDF.

/** Scanned pages OCR'd per upload; a page takes roughly 1–5 seconds. */
export const MAX_OCR_PAGES = 20;
/** Words below this confidence (0–100) mark their row as one to check. */
export const LOW_CONFIDENCE = 70;

export type OcrItem = TextItem & { confidence: number };
export type OcrResult = { items: OcrItem[]; confidence: number };

type TesseractWorker = Awaited<ReturnType<typeof import("tesseract.js").createWorker>>;
let workerPromise: Promise<TesseractWorker> | undefined;
let queue: Promise<unknown> = Promise.resolve();

/** Both language files in one local folder (tesseract.js takes a single langPath). Never fetched from a CDN. */
async function langPath(): Promise<string> {
  const dir = path.join(tmpdir(), "sawwi-tessdata-4.0.0_best_int");
  mkdirSync(dir, { recursive: true });
  for (const lang of ["eng", "ara"] as const) {
    const target = path.join(dir, `${lang}.traineddata.gz`);
    if (existsSync(target)) continue;
    const pkg = lang === "eng" ? await import("@tesseract.js-data/eng") : await import("@tesseract.js-data/ara");
    const base = (pkg.default ?? pkg).langPath;
    copyFileSync(path.join(base, "..", "4.0.0_best_int", `${lang}.traineddata.gz`), target);
  }
  return dir;
}

function worker(): Promise<TesseractWorker> {
  workerPromise ??= (async () => {
    const { createWorker } = await import("tesseract.js");
    return createWorker(["eng", "ara"], 1, { langPath: await langPath(), cacheMethod: "none", gzip: true, logger: () => {} });
  })().catch((error) => {
    workerPromise = undefined;
    throw error;
  });
  return workerPromise;
}

/** A 24-bit BMP: a format tesseract's image reader takes, built without any image library. */
export function rgbaToBmp(rgba: Uint8ClampedArray, width: number, height: number): Buffer {
  const row = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + row * height;
  const buf = Buffer.alloc(size);
  buf.write("BM", 0);
  buf.writeUInt32LE(size, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(-height, 22); // top-down rows
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(row * height, 34);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const o = 54 + y * row + x * 3;
      buf[o] = rgba[i + 2];
      buf[o + 1] = rgba[i + 1];
      buf[o + 2] = rgba[i];
    }
  }
  return buf;
}

type OcrWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
type OcrBlock = { paragraphs: { lines: { words: OcrWord[] }[] }[] };

/** OCRs each page's scan and returns words in page coordinates, like pdf.js text items. */
export async function ocrPages(images: PageImage[]): Promise<OcrResult> {
  const run = queue.then(async () => {
    const w = await worker();
    const items: OcrItem[] = [];
    for (const img of images) {
      const { data } = await w.recognize(rgbaToBmp(img.rgba, img.width, img.height), {}, { blocks: true });
      // The scan fills the page: image pixels map onto page units.
      const sx = img.pageWidth / img.width;
      const sy = img.pageHeight / img.height;
      const words = ((data.blocks ?? []) as OcrBlock[]).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
      for (const word of words) {
        // Specks and rules read as "~~", "|" or "—": a word with no letter or digit is noise.
        if (!/[\p{L}\p{N}]/u.test(word.text)) continue;
        const h = (word.bbox.y1 - word.bbox.y0) * sy;
        items.push({
          str: word.text,
          x: word.bbox.x0 * sx,
          // pdf.js gives the baseline; the bottom of the box is close enough for grouping lines.
          y: word.bbox.y1 * sy,
          w: (word.bbox.x1 - word.bbox.x0) * sx,
          h: Math.max(h, 4),
          page: img.page,
          confidence: word.confidence,
        });
      }
    }
    const confidence = items.length ? items.reduce((s, i) => s + i.confidence, 0) / items.length : 0;
    return { items, confidence };
  });
  // One recognition at a time: the worker is shared by every upload on this server.
  queue = run.catch(() => undefined);
  return run;
}
