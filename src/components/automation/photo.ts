import { cleanUpPhoto, jpegsToPdf, type JpegPage } from "@/lib/automation/purchase-invoices/photo-pdf";

// In the browser: phone photos of an invoice's pages → one PDF for upload (D-67). Each photo is
// turned upright (EXIF), then by the user's quarter turns, scaled to at most 2400 px on its long
// side, made grayscale with paper pushed to white (OCR reads paper photos better that way), and
// saved as JPEG on its own page.

const MAX_SIDE = 2400;
export const MAX_PAGES = 10;

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Older Safari: an <img> applies EXIF orientation itself.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** One page: the photo upright, rotated by `quarterTurns` × 90° clockwise, as a cleaned-up JPEG. */
export async function photoToJpeg(file: File, quarterTurns = 0): Promise<JpegPage> {
  const img = await decode(file);
  const w0 = "naturalWidth" in img ? img.naturalWidth : img.width;
  const h0 = "naturalHeight" in img ? img.naturalHeight : img.height;
  if (!w0 || !h0) throw new Error("That photo couldn't be read.");
  const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  const sw = Math.round(w0 * scale);
  const sh = Math.round(h0 * scale);
  const turns = ((quarterTurns % 4) + 4) % 4;
  const [width, height] = turns % 2 ? [sh, sw] : [sw, sh];
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("This browser can't prepare photos.");
  g.translate(width / 2, height / 2);
  g.rotate((turns * Math.PI) / 2);
  g.drawImage(img, -sw / 2, -sh / 2, sw, sh);
  g.setTransform(1, 0, 0, 1, 0, 0);

  const data = g.getImageData(0, 0, width, height);
  cleanUpPhoto(data.data);
  g.putImageData(data, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("That photo couldn't be prepared.");
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), width, height };
}

/** All pages, in order, as one PDF file ready to upload. */
export async function photosToPdf(pages: { file: File; turns: number }[]): Promise<File> {
  const jpegs: JpegPage[] = [];
  for (const p of pages) jpegs.push(await photoToJpeg(p.file, p.turns));
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return new File([jpegsToPdf(jpegs)], `photo-${stamp}.pdf`, { type: "application/pdf" });
}
