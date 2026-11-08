import { createHash } from "node:crypto";
import { deleteFiles, fileSize, readStoredFile } from "@/lib/files/storage";
import { CaptureError, MAX_PDF_BYTES } from "./service";

// Supplier invoice PDFs the browser put straight into the private Blob store (D-39, D-61), under a
// folder named from the workspace, so one workspace can never hand the server another's upload.

export const MAX_PDFS_PER_UPLOAD = 50;
export const incomingFolder = (orgKey: string) => `incoming/automation/${createHash("sha256").update(orgKey).digest("hex").slice(0, 24)}/`;

type Ref = { pathname: string; name: string };
const valid = (orgKey: string, r: unknown): r is Ref => {
  const prefix = incomingFolder(orgKey);
  return typeof r === "object" && r !== null && typeof (r as Ref).pathname === "string" && typeof (r as Ref).name === "string" && (r as Ref).pathname.startsWith(prefix) && !(r as Ref).pathname.slice(prefix.length).includes("/");
};

export async function readIncomingPdfs(orgKey: string, refs: unknown): Promise<{ name: string; bytes: Uint8Array; pathname: string }[]> {
  if (!Array.isArray(refs) || refs.length === 0) throw new CaptureError("Choose PDFs to upload.");
  if (refs.length > MAX_PDFS_PER_UPLOAD) throw new CaptureError(`Upload up to ${MAX_PDFS_PER_UPLOAD} invoices at a time.`);
  if (!refs.every((r) => valid(orgKey, r))) throw new CaptureError("That upload doesn't belong to this workspace.");
  const out = [];
  for (const r of refs as Ref[]) {
    const size = await fileSize(r.pathname);
    if (size === undefined) throw new CaptureError(`${r.name} didn't arrive. Try again.`);
    if (size > MAX_PDF_BYTES) throw new CaptureError(`${r.name} is over 10 MB.`);
    out.push({ name: r.name, bytes: (await readStoredFile(r.pathname))!, pathname: r.pathname });
  }
  return out;
}

/** Raw uploads go once read: the draft keeps its own copy of the PDF. */
export async function discardIncomingPdfs(orgKey: string, refs: unknown) {
  if (!Array.isArray(refs)) return;
  await deleteFiles(refs.filter((r) => valid(orgKey, r)).map((r) => (r as Ref).pathname)).catch(() => undefined);
}
