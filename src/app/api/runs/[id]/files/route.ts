import { MAX_FILES_PER_SLOT, MAX_UPLOAD_BYTES, UnsupportedFileError } from "@/lib/files/parse";
import { discardIncoming, IncomingError, readIncoming } from "@/lib/files/incoming";
import { isDemoOrg } from "@/lib/demo/demo";
import { getOwnedRun } from "@/lib/runs/access";
import { runBlocker } from "@/lib/saas/session";
import { ingestFiles, RunInputError } from "@/lib/runs/engine";
import { buildRunView } from "@/lib/runs/view";

// Uploads go through a route handler rather than a server action: actions cap bodies at 1 MB.
// Two shapes (D-39):
// - multipart form data with the files (local development, no Blob store);
// - JSON { slot, uploads: [{ pathname, name }] } naming files the browser already put in the
//   private Blob store, because Vercel caps a request body at 4.5 MB.
export async function POST(request: Request, ctx: RouteContext<"/api/runs/[id]/files">) {
  const { id } = await ctx.params;
  const owned = await getOwnedRun(id);
  if (!owned) return Response.json({ error: "Run not found." }, { status: 404 });

  const isJson = request.headers.get("content-type")?.includes("application/json");
  const json = isJson ? ((await request.json().catch(() => ({}))) as { slot?: unknown; uploads?: unknown }) : undefined;
  // The demo store is shared by everyone who opens it, so nobody's real files go into it (D-32).
  if (isDemoOrg(owned.run.orgKey)) {
    if (json && typeof json.slot === "string") await discardIncoming(id, json.slot, json.uploads);
    return Response.json({ error: "Uploads are off in the live demo. Use “Fill with demo data”, or sign up to reconcile your own files." }, { status: 403 });
  }
  // A new file is new work on the run: viewers, suspended workspaces and ended trials can't (like pulls and reconciling).
  const blocked = await runBlocker();
  if (blocked) {
    if (json && typeof json.slot === "string") await discardIncoming(id, json.slot, json.uploads);
    return Response.json({ error: blocked.message }, { status: 403 });
  }

  let slot: unknown;
  let data: { name: string; data: Uint8Array }[];
  try {
    if (json) {
      slot = json.slot;
      if (typeof slot !== "string") return Response.json({ error: "Choose a file to upload." }, { status: 400 });
      data = await readIncoming(id, slot, json.uploads);
    } else {
      const form = await request.formData();
      slot = form.get("slot");
      // Several files can go into one slot, e.g. a month of supplier invoice PDFs.
      const files = form.getAll("file").filter((f): f is File => f instanceof File);
      if (typeof slot !== "string" || files.length === 0) {
        return Response.json({ error: "Choose a file to upload." }, { status: 400 });
      }
      if (files.length > MAX_FILES_PER_SLOT) {
        return Response.json({ error: `Upload up to ${MAX_FILES_PER_SLOT} files at once into one slot.` }, { status: 400 });
      }
      if (files.reduce((s, f) => s + f.size, 0) > MAX_UPLOAD_BYTES) {
        return Response.json({ error: "That upload is over 25 MB. Export a shorter period, or contact us for bulk uploads." }, { status: 413 });
      }
      data = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
    }
    await ingestFiles(owned.run, slot, data, { countries: owned.profile.countries });
  } catch (error) {
    if (error instanceof RunInputError || error instanceof UnsupportedFileError || error instanceof IncomingError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  } finally {
    if (json && typeof json.slot === "string") await discardIncoming(id, json.slot, json.uploads);
  }
  return Response.json({ view: await buildRunView(id) });
}
