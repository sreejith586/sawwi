import { timingSafeEqual } from "node:crypto";
import { tick } from "@/lib/jobs/runner";

// Vercel Cron calls this every 15 minutes (vercel.json, D-42) with
// `Authorization: Bearer $CRON_SECRET`. Anyone else gets 401; without a secret it's switched off.
export const maxDuration = 60;

function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Reading the request's headers makes this dynamic: it never runs at build time.
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ error: "Background jobs are off: CRON_SECRET is not set." }, { status: 503 });
  if (!authorized(request.headers.get("authorization"))) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const result = await tick();
  console.log("cron tick", JSON.stringify(result));
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
