import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { isDemoOrg } from "@/lib/demo/demo";
import { blobEnabled, blobToken } from "@/lib/files/storage";
import { MAX_UPLOAD_BYTES, UPLOAD_CONTENT_TYPES } from "@/lib/files/upload-paths";
import { getOwnedRun } from "@/lib/runs/access";

// Issues short-lived tokens for the browser to upload a file straight to the private Blob
// store (D-39), with the same checks as /api/runs/[id]/files: the run must be the signed-in
// workspace's, and the demo store takes no uploads. The token only allows this run's folder.
export async function POST(request: Request, ctx: RouteContext<"/api/runs/[id]/uploads">) {
  if (!blobEnabled()) return Response.json({ error: "Direct uploads are off here." }, { status: 404 });
  const { id } = await ctx.params;
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      token: blobToken(),
      onBeforeGenerateToken: async (pathname) => {
        const owned = await getOwnedRun(id);
        if (!owned) throw new Error("Run not found.");
        if (isDemoOrg(owned.run.orgKey)) throw new Error("Uploads are off in the live demo.");
        if (!pathname.startsWith(`incoming/${id}/`)) throw new Error("Uploads must go to this run.");
        return {
          allowedContentTypes: UPLOAD_CONTENT_TYPES,
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true,
          validUntil: Date.now() + 10 * 60_000,
        };
      },
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Upload refused." }, { status: 400 });
  }
}
