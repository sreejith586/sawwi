// Phone photos of an invoice's pages → one PDF, a JPEG per page (D-67). The browser does
// this before upload, so a photo takes the same path as a scanned PDF: local OCR on the server
// (D-24), the PDF kept for review (D-61). Pure and dependency-free, so it runs in the browser
// and in tests.

const enc = new TextEncoder();

/**
 * Grayscale with paper pushed to white and ink kept dark, in place on RGBA pixels. The paper
 * tone (60th percentile) maps to white; the darkest 0.5% (ink) to black, with at least 96 levels
 * between them, so a page that is mostly paper doesn't turn JPEG noise into speckle.
 */
export function cleanUpPhoto(px: Uint8ClampedArray) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const y = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    px[i] = y;
    hist[y]++;
  }
  const total = px.length / 4;
  const at = (share: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= total * share) return v;
    return 255;
  };
  const paper = at(0.6);
  const ink = Math.max(0, Math.min(at(0.005), paper - 96));
  const span = Math.max(1, paper - ink);
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.max(0, Math.min(255, Math.round(((px[i] - ink) * 255) / span)));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
}

export type JpegPage = { jpeg: Uint8Array; width: number; height: number };

/** One page from one JPEG. */
export const jpegToPdf = (jpeg: Uint8Array, width: number, height: number) => jpegsToPdf([{ jpeg, width, height }]);

/**
 * A minimal PDF 1.4 with one page per photo, in order, each JPEG (DCT) filling its page.
 * Pages are A4's 595 pt wide, as tall as the photo's proportions make them.
 */
export function jpegsToPdf(pages: JpegPage[]): Uint8Array<ArrayBuffer> {
  if (pages.length === 0) throw new Error("No pages.");
  for (const p of pages) if (p.jpeg[0] !== 0xff || p.jpeg[1] !== 0xd8) throw new Error("Not a JPEG.");
  const parts: (string | Uint8Array)[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (p: string | Uint8Array) => {
    parts.push(p);
    length += typeof p === "string" ? enc.encode(p).length : p.length;
  };
  const obj = (n: number, body: string | (string | Uint8Array)[]) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    for (const p of Array.isArray(body) ? body : [body]) push(p);
    push("\nendobj\n");
  };

  // Objects: 1 catalog, 2 page tree, then per page i: page, image, content (3 + 3i …).
  const pageObj = (i: number) => 3 + 3 * i;
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  pages.forEach(({ jpeg, width, height }, i) => {
    const n = pageObj(i);
    const pageW = 595;
    const pageH = Math.round((pageW * height) / width);
    const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`;
    obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 ${n + 1} 0 R >> >> /Contents ${n + 2} 0 R >>`);
    obj(n + 1, [`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, "\nendstream"]);
    obj(n + 2, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  const count = 3 + 3 * pages.length;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n${Array.from({ length: count - 1 }, (_, i) => `${String(offsets[i + 1]).padStart(10, "0")} 00000 n \n`).join("")}`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(new ArrayBuffer(length));
  let at = 0;
  for (const p of parts) {
    const bytes = typeof p === "string" ? enc.encode(p) : p;
    out.set(bytes, at);
    at += bytes.length;
  }
  return out;
}
