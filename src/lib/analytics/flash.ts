// Events that happen on the server and end in a redirect (sign-up, log in, log out, demo start,
// onboarding done, a run started) can't call track() in the browser. The server action leaves
// them in a short-lived cookie; the browser sends them on the next page and deletes it (D-97).

import { isEventName, sanitizeParams, type EventName, type SafeValue } from "./events";

export const FLASH_COOKIE = "sawwi_ae";
export const FLASH_MAX_AGE = 60;

export type FlashedEvent = [EventName, Record<string, SafeValue>];

/** Reads the cookie value back into events, dropping anything unknown or unsafe. */
export function parseFlash(raw: string | undefined): FlashedEvent[] {
  if (!raw) return [];
  try {
    // Next encodes cookie values when it sets them; read as is, or decoded once or twice.
    let text = raw;
    for (let i = 0; i < 2 && !text.startsWith("["); i++) text = decodeURIComponent(text);
    const list = JSON.parse(text) as unknown;
    if (!Array.isArray(list)) return [];
    return list
      .slice(0, 5)
      .filter((e): e is [EventName, unknown] => Array.isArray(e) && isEventName(e[0]))
      .map(([name, params]) => [name, sanitizeParams(params)]);
  } catch {
    return [];
  }
}

/** The cookie value: plain JSON (cookies().set encodes it). */
export const encodeFlash = (events: FlashedEvent[]) => JSON.stringify(events.slice(-5));
