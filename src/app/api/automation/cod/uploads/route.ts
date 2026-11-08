import { issueSignedToken } from "@vercel/blob";
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { isDemoOrg } from "@/lib/demo/demo";
import { blobAuth, blobEnabled } from "@/lib/files/storage";
import { UPLOAD_CONTENT_TYPES } from "@/lib/files/upload-paths";
import { codIncomingFolder, MAX_REMITTANCE_BYTES } from "@/lib/automation/cod/service";
import { getCurrentSession, runBlocker } from "@/lib/saas/session";

// A short-lived presigned URL for one COD remittance report, straight to the private Blob store
// (D-39), in this workspace's incoming folder only.
export async function POST(request: Request) {
  if (!blobEnabled()) return Response.json({ error: "Direct uploads are off here." }, { status: 404 });
  const body = (await request.json()) as HandleUploadPresignedBody;
  try {
    const result = await handleUploadPresigned({
      body,
      request,
      getSignedToken: async (pathname) => {
        const session = await getCurrentSession();
        if (!session) throw new Error("Log in again.");
        if (isDemoOrg(session.org.key)) throw new Error("Uploads are off in the live demo.");
        const blocked = await runBlocker();
        if (blocked) throw new Error(blocked.message);
        const folder = codIncomingFolder(session.org.key);
        if (!pathname.startsWith(folder) || pathname.slice(folder.length).includes("/") || pathname.includes("..")) throw new Error("Uploads must go to this workspace.");
        const limits = { allowedContentTypes: UPLOAD_CONTENT_TYPES, maximumSizeInBytes: MAX_REMITTANCE_BYTES, validUntil: Date.now() + 10 * 60_000 };
        const token = await issueSignedToken({ pathname, operations: ["put"], ...limits, ...blobAuth() });
        return { token, urlOptions: { ...limits, addRandomSuffix: true } };
      },
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Upload refused." }, { status: 400 });
  }
}
