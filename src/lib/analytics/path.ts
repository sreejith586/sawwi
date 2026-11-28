// Page paths as analytics sees them (D-97): the route, never a record. Run, invoice, settlement
// and batch IDs become ":id", custom template IDs become ":custom", and query strings and
// fragments are dropped (they carry reset tokens, search text and "next" links).

import { CUSTOM_PREFIX } from "@/lib/templates/custom";

// Routes whose segment after the prefix is a workspace's record, not a public page.
const RECORD_ROUTES = ["/runs/", "/automation/purchase-invoices/", "/automation/settlements/", "/automation/cod/"];

// Anything that looks like an ID wherever it appears: a UUID, a long hex or token, or a number.
const ID_LIKE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|[A-Za-z0-9_-]{24,}|\d+)$/i;

export function normalizePath(raw: string): string {
  const path = (raw.split(/[?#]/)[0] || "/").replace(/\/{2,}/g, "/");
  const segments = path.split("/").map((seg, i, all) => {
    if (!seg) return seg;
    const before = all.slice(0, i).join("/") + "/";
    if (RECORD_ROUTES.includes(before)) return ":id";
    if (seg.startsWith(CUSTOM_PREFIX)) return ":custom";
    if (ID_LIKE.test(seg)) return ":id";
    return seg;
  });
  const out = segments.join("/");
  return out.length > 1 && out.endsWith("/") ? out.slice(0, -1) : out || "/";
}

/** Pages Clarity never records, even masked: their URL carries a secret (the reset token). */
export const CLARITY_EXCLUDED = ["/reset-password"];
