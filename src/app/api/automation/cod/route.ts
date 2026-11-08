import { isDemoOrg } from "@/lib/demo/demo";
import { deleteFiles, fileSize, readStoredFile } from "@/lib/files/storage";
import { captureFile, CodError, codIncomingFolder, MAX_REMITTANCE_BYTES } from "@/lib/automation/cod/service";
import { getCurrentSession, runBlocker } from "@/lib/saas/session";

// COD remittance reports in (D-74): multipart files, or JSON { uploads } naming files the browser put in
// the private Blob store (D-39), under this workspace's folder only. Each file answers on its own.
export const maxDuration = 120;

type Ref = { pathname: string; name: string };

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return Response.json({ error: "Log in again." }, { status: 401 });
  const orgKey = session.org.key;
  const folder = codIncomingFolder(orgKey);
  const isJson = request.headers.get("content-type")?.includes("application/json");
  const json = isJson ? ((await request.json().catch(() => ({}))) as { uploads?: unknown }) : undefined;
  const refs = (Array.isArray(json?.uploads) ? json!.uploads : []).filter(
    (r): r is Ref => typeof r === "object" && r !== null && typeof (r as Ref).pathname === "string" && typeof (r as Ref).name === "string" && (r as Ref).pathname.startsWith(folder) && !(r as Ref).pathname.slice(folder.length).includes("/"),
  );
  const cleanup = () => deleteFiles(refs.map((r) => r.pathname)).catch(() => undefined);
  if (isDemoOrg(orgKey)) {
    await cleanup();
    return Response.json({ error: "Uploads are off in the live demo. Try a sample remittance, or sign up to use your own." }, { status: 403 });
  }
  const blocked = await runBlocker();
  if (blocked) {
    await cleanup();
    return Response.json({ error: blocked.message }, { status: 403 });
  }

  let files: { name: string; bytes: Uint8Array }[] = [];
  if (json) {
    for (const r of refs.slice(0, 20)) {
      const size = await fileSize(r.pathname);
      const bytes = size !== undefined && size <= MAX_REMITTANCE_BYTES ? await readStoredFile(r.pathname) : undefined;
      if (bytes) files.push({ name: r.name, bytes });
    }
    await cleanup();
  } else {
    const form = await request.formData();
    const picked = form.getAll("file").filter((f): f is File => f instanceof File).slice(0, 20);
    if (picked.some((f) => f.size > MAX_REMITTANCE_BYTES)) return Response.json({ error: "Each file must be under 25 MB." }, { status: 413 });
    files = await Promise.all(picked.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
  }
  if (files.length === 0) return Response.json({ error: "Choose remittance reports to upload." }, { status: 400 });

  const results: { name: string; batches?: { batchId: string; courier: string; existing: boolean }[]; error?: string }[] = [];
  for (const f of files) {
    try {
      const r = await captureFile(orgKey, session.user.id, f);
      results.push({ name: f.name, batches: r.map(({ batchId, courier, existing }) => ({ batchId, courier, existing })) });
    } catch (error) {
      if (!(error instanceof CodError)) console.error("COD remittance capture failed", error);
      results.push({ name: f.name, error: error instanceof CodError ? error.message : `${f.name}: Sawwi couldn't read this file.` });
    }
  }
  return Response.json({ results });
}
