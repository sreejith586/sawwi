import { issueSignedToken } from "@vercel/blob";
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { isDemoOrg } from "@/lib/demo/demo";
import { blobAuth, blobEnabled } from "@/lib/files/storage";
import { MAX_UPLOAD_BYTES, UPLOAD_CONTENT_TYPES } from "@/lib/files/upload-paths";
import { getOwnedRun } from "@/lib/runs/access";
import { runBlocker } from "@/lib/saas/session";

// Issues a short-lived presigned URL for the browser to upload one file straight to the private
// Blob store (D-39), with the same checks as /api/runs/[id]/files: the run must be the signed-in
// workspace's, the user must be allowed to work on it (runBlocker), and the demo store takes no
// uploads. The signed token allows one operation (put) on one path inside this run's folder.
export async function POST(request: Request, ctx: RouteContext<"/api/runs/[id]/uploads">) {
  if (!blobEnabled()) return Response.json({ error: "Direct uploads are off here." }, { status: 404 });
  const { id } = await ctx.params;
  const body = (await request.json()) as HandleUploadPresignedBody;
  try {
    const result = await handleUploadPresigned({
      body,
      request,
      getSignedToken: async (pathname) => {
        const owned = await getOwnedRun(id);
        if (!owned) throw new Error("Run not found.");
        if (isDemoOrg(owned.run.orgKey)) throw new Error("Uploads are off in the live demo.");
        const blocked = await runBlocker();
        if (blocked) throw new Error(blocked.message);
        if (!pathname.startsWith(`incoming/${id}/`) || pathname.includes("..")) throw new Error("Uploads must go to this run.");
        const limits = { allowedContentTypes: UPLOAD_CONTENT_TYPES, maximumSizeInBytes: MAX_UPLOAD_BYTES, validUntil: Date.now() + 10 * 60_000 };
        const token = await issueSignedToken({ pathname, operations: ["put"], ...limits, ...blobAuth() });
        return { token, urlOptions: { ...limits, addRandomSuffix: true } };
      },
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Upload refused." }, { status: 400 });
  }
}
