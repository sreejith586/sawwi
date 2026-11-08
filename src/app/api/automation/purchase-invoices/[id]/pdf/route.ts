import { readStoredFile } from "@/lib/files/storage";
import { getCapture } from "@/lib/automation/purchase-invoices/store";
import { getCurrentSession } from "@/lib/saas/session";

// The supplier's PDF next to its draft on the review screen (D-61). Workspace members only.
export async function GET(_request: Request, ctx: RouteContext<"/api/automation/purchase-invoices/[id]/pdf">) {
  const { id } = await ctx.params;
  const session = await getCurrentSession();
  const capture = session && (await getCapture(session.org.key, id));
  const bytes = capture?.storedPath ? await readStoredFile(capture.storedPath) : undefined;
  if (!bytes) return Response.json({ error: "Not found." }, { status: 404 });
  const name = capture!.fileName.replace(/[^\w.\- ]+/g, "_");
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
