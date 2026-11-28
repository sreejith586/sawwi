import type { BeforeSendEvent } from "@vercel/analytics/next";
import { normalizePath } from "./path";

// Vercel Web Analytics (D-98) sees the same page paths as GA4 (D-97): the route, never a record.
// IDs become ":id" and query strings and fragments are dropped, so a reset token, search text or
// a connector's account name never leaves the browser. Anything that isn't a URL isn't sent.
export function vercelBeforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    const url = new URL(event.url);
    return { ...event, url: `${url.origin}${normalizePath(url.pathname)}` };
  } catch {
    return null;
  }
}
