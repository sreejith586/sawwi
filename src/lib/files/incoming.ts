import { deleteFiles, fileSize, readStoredFile } from "./storage";
import { MAX_FILES_PER_SLOT, MAX_UPLOAD_BYTES } from "./upload-paths";

// Browser uploads that went straight to the private Blob store (D-39): Vercel caps a function's
// request body at 4.5 MB, below Sawwi's 25 MB upload limit, so the file itself never passes
// through a function. The server reads it back, parses it and deletes the raw copy.

export type IncomingRef = { pathname: string; name: string };

export class IncomingError extends Error {}

/** Checks refs belong to this run's slot and fit the limits, then reads them. */
export async function readIncoming(runId: string, slotKey: string, refs: unknown): Promise<{ name: string; data: Uint8Array }[]> {
  if (!Array.isArray(refs) || refs.length === 0) throw new IncomingError("Choose a file to upload.");
  if (refs.length > MAX_FILES_PER_SLOT) throw new IncomingError(`Upload up to ${MAX_FILES_PER_SLOT} files at once into one slot.`);
  const prefix = `incoming/${runId}/${slotKey}/`;
  const valid = refs.every(
    (r): r is IncomingRef =>
      typeof r === "object" && r !== null && typeof r.pathname === "string" && typeof r.name === "string" && r.pathname.startsWith(prefix) && !r.pathname.slice(prefix.length).includes("/"),
  );
  if (!valid) throw new IncomingError("That upload doesn't belong to this file slot.");
  const sizes = await Promise.all(refs.map((r) => fileSize(r.pathname)));
  if (sizes.some((s) => s === undefined)) throw new IncomingError("The upload didn't arrive. Try again.");
  if (sizes.reduce((a: number, s) => a + (s ?? 0), 0) > MAX_UPLOAD_BYTES) {
    throw new IncomingError("That upload is over 25 MB. Export a shorter period, or contact us for bulk uploads.");
  }
  return Promise.all(refs.map(async (r) => ({ name: r.name, data: (await readStoredFile(r.pathname))! })));
}

/** Raw uploads are only kept until they're parsed: the run keeps its normalized table. */
export async function discardIncoming(runId: string, slotKey: string, refs: unknown) {
  if (!Array.isArray(refs)) return;
  // Only this run's slot: a ref naming another run's upload is ignored, never deleted.
  const prefix = `incoming/${runId}/${slotKey}/`;
  const keys = refs
    .map((r: Partial<IncomingRef> | null) => r?.pathname)
    .filter((p): p is string => typeof p === "string" && p.startsWith(prefix) && !p.slice(prefix.length).includes("/"));
  await deleteFiles(keys).catch(() => undefined);
}
