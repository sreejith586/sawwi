import { isDemoOrg } from "@/lib/demo/demo";
import { getProfile } from "@/lib/profile/session";
import { getCurrentSession, runBlocker } from "@/lib/saas/session";
import { discardIncomingPdfs, MAX_PDFS_PER_UPLOAD, readIncomingPdfs } from "@/lib/automation/purchase-invoices/incoming";
import { capturePdf, CaptureError, MAX_PDF_BYTES } from "@/lib/automation/purchase-invoices/service";

// Supplier invoice PDFs in, one draft each (D-61). A route handler, not an action: actions cap
// bodies at 1 MB. Two shapes, as for reconciliation uploads (D-39): multipart files (no Blob
// store), or JSON { uploads: [{ pathname, name }] } naming PDFs already put in the Blob store.
// Each file is answered on its own, so one unreadable PDF doesn't stop the rest.
export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return Response.json({ error: "Log in again." }, { status: 401 });
  const orgKey = session.org.key;
  const isJson = request.headers.get("content-type")?.includes("application/json");
  const json = isJson ? ((await request.json().catch(() => ({}))) as { uploads?: unknown }) : undefined;
  // The demo store is shared by everyone who opens it: samples only, no real invoices (D-32).
  if (isDemoOrg(orgKey)) {
    if (json) await discardIncomingPdfs(orgKey, json.uploads);
    return Response.json({ error: "Uploads are off in the live demo. Try a sample invoice, or sign up to capture your own." }, { status: 403 });
  }
  const blocked = await runBlocker();
  if (blocked) {
    if (json) await discardIncomingPdfs(orgKey, json.uploads);
    return Response.json({ error: blocked.message }, { status: 403 });
  }

  let files: { name: string; bytes: Uint8Array }[];
  try {
    if (json) files = await readIncomingPdfs(orgKey, json.uploads);
    else {
      const form = await request.formData();
      const picked = form.getAll("file").filter((f): f is File => f instanceof File);
      if (picked.length === 0) return Response.json({ error: "Choose PDFs to upload." }, { status: 400 });
      if (picked.length > MAX_PDFS_PER_UPLOAD) return Response.json({ error: `Upload up to ${MAX_PDFS_PER_UPLOAD} invoices at a time.` }, { status: 400 });
      const big = picked.find((f) => f.size > MAX_PDF_BYTES);
      if (big) return Response.json({ error: `${big.name} is over 10 MB.` }, { status: 413 });
      files = await Promise.all(picked.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    }
  } catch (error) {
    if (json) await discardIncomingPdfs(orgKey, json.uploads);
    return Response.json({ error: error instanceof CaptureError ? error.message : "Upload failed." }, { status: 400 });
  }

  const countries = (await getProfile())?.countries;
  const results: { name: string; id?: string; existing?: boolean; error?: string }[] = [];
  for (const f of files) {
    try {
      const { capture, existing } = await capturePdf(orgKey, session.user.id, f, { countries });
      results.push({ name: f.name, id: capture.id, existing });
    } catch (error) {
      if (!(error instanceof CaptureError)) console.error("purchase invoice capture failed", error);
      results.push({ name: f.name, error: error instanceof CaptureError ? error.message : `${f.name}: Sawwi couldn't read this PDF.` });
    }
  }
  if (json) await discardIncomingPdfs(orgKey, json.uploads);
  return Response.json({ results });
}
