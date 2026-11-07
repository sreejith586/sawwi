import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { blobEnabled, fileSize } from "@/lib/files/storage";

// Liveness for uptime checks and the deploy runbook (docs/DEPLOY.md): can this deployment reach
// its database and file store? Public, so it says only ok/failing per part, never why.
export async function GET() {
  await connection();
  const check = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return "ok" as const;
    } catch (error) {
      console.error("health check failed:", error);
      return "failing" as const;
    }
  };
  const [database, files] = await Promise.all([
    check(() => getDb().get("SELECT 1 AS ok")),
    // A size lookup of a key that never exists: proves the store answers without writing to it.
    check(() => fileSize("health/probe")),
  ]);
  const ok = database === "ok" && files === "ok";
  return Response.json(
    { ok, database, files, fileStore: blobEnabled() ? "blob" : "disk", region: process.env.VERCEL_REGION ?? "local" },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
