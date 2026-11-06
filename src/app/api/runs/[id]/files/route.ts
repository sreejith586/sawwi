import { MAX_UPLOAD_BYTES, UnsupportedFileError } from "@/lib/files/parse";
import { getOwnedRun } from "@/lib/runs/access";
import { ingestFile, RunInputError } from "@/lib/runs/engine";
import { buildRunView } from "@/lib/runs/view";

// Uploads go through a route handler rather than a server action: actions cap bodies at 1 MB.
export async function POST(request: Request, ctx: RouteContext<"/api/runs/[id]/files">) {
  const { id } = await ctx.params;
  const owned = await getOwnedRun(id);
  if (!owned) return Response.json({ error: "Run not found." }, { status: 404 });

  const form = await request.formData();
  const slot = form.get("slot");
  const file = form.get("file");
  if (typeof slot !== "string" || !(file instanceof File)) {
    return Response.json({ error: "Choose a file to upload." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ error: "That file is over 25 MB. Export a shorter period, or contact us for bulk uploads." }, { status: 413 });
  }

  try {
    await ingestFile(owned.run, slot, file.name, new Uint8Array(await file.arrayBuffer()), {
      countries: owned.profile.countries,
    });
  } catch (error) {
    if (error instanceof RunInputError || error instanceof UnsupportedFileError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
  return Response.json({ view: buildRunView(id) });
}
