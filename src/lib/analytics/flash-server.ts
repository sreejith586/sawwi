import { cookies } from "next/headers";
import type { AnalyticsEvents, EventArgs, EventName } from "./events";
import { sanitizeParams } from "./events";
import { encodeFlash, FLASH_COOKIE, FLASH_MAX_AGE, parseFlash } from "./flash";

const enabled = () => Boolean((process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "").trim() || (process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID ?? "").trim());

/**
 * Queues an event for the browser to send on the next page (see flash.ts). Call it in a server
 * action before redirect(). Does nothing when analytics is off, so no cookie is set.
 */
export async function flashEvent<E extends EventName>(event: E, ...[params]: EventArgs<E>): Promise<void> {
  if (!enabled()) return;
  const jar = await cookies();
  const queued = parseFlash(jar.get(FLASH_COOKIE)?.value);
  queued.push([event, sanitizeParams(params satisfies AnalyticsEvents[E] | undefined)]);
  // Readable by the page's script (it sends and deletes it), so not httpOnly. It holds only an
  // event name and categories, never anything about the user.
  jar.set(FLASH_COOKIE, encodeFlash(queued), { path: "/", maxAge: FLASH_MAX_AGE, sameSite: "lax", secure: process.env.NODE_ENV === "production", httpOnly: false });
}
