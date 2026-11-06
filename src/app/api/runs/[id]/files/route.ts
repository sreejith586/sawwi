import { MAX_FILES_PER_SLOT, MAX_UPLOAD_BYTES, UnsupportedFileError } from "@/lib/files/parse";
import { getOwnedRun } from "@/lib/runs/access";
import { ingestFiles, RunInputError } from "@/lib/runs/engine";
import { buildRunView } from "@/lib/runs/view";

// Uploads go through a route handler rather than a server action: actions cap bodies at 1 MB.
export async function POST(request: Request, ctx: RouteContext<"/api/runs/[id]/files">) {
  const { id } = await ctx.params;
  const owned = await getOwnedRun(id);
  if (!owned) return Response.json({ error: "Run not found." }, { status: 404 });

  const form = await request.formData();
  const slot = form.get("slot");
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

  try {
    const data = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
    await ingestFiles(owned.run, slot, data, { countries: owned.profile.countries });
  } catch (error) {
    if (error instanceof RunInputError || error instanceof UnsupportedFileError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
  return Response.json({ view: buildRunView(id) });
}
