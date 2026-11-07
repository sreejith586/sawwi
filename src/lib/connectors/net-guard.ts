import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ConnectorError } from "./types";

// Some sources live on the customer's own domain (Magento), so their host can't be pinned
// like Shopify's or Business Central's. Every live connector request therefore goes to
// https only, to a host that resolves to public addresses only, and never follows a
// redirect (D-30). This keeps a connection from pointing Sawwi's server at its own network.

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
}
const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

/** True for loopback, private, link-local, CGNAT, multicast and reserved addresses. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const n = v4ToInt(ip);
    return V4_BLOCKED.some(([base, bits]) => (n >>> (32 - bits)) === (v4ToInt(base) >>> (32 - bits)));
  }
  if (kind === 6) {
    const a = ip.toLowerCase();
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return a === "::" || a === "::1" || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || /^ff/.test(a);
  }
  return true; // not an address at all: refuse
}

/** Syntax check for a host typed by a user: a public DNS name, not an IP or a local name. */
export function isPublicHostname(host: string): boolean {
  const h = host.toLowerCase();
  if (isIP(h.replace(/^\[|\]$/g, ""))) return false;
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h)) return false;
  return !/(^|\.)(localhost|local|internal|lan|home|corp|intranet|localdomain)$/.test(h);
}

/** Resolves the URL's host and refuses anything that isn't https to public addresses only. */
export async function assertPublicUrl(url: string, resolve: (host: string) => Promise<string[]> = defaultResolve): Promise<void> {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.username || u.password) throw new ConnectorError("Only https addresses without a user name or password are allowed.");
  if (!isPublicHostname(u.hostname)) throw new ConnectorError(`${u.hostname} isn't a public address.`);
  const addresses = await resolve(u.hostname).catch(() => [] as string[]);
  if (addresses.length === 0) throw new ConnectorError(`Couldn't find ${u.hostname}. Check the address.`);
  if (addresses.some(isPrivateAddress)) throw new ConnectorError(`${u.hostname} points to a private network address, which Sawwi won't connect to.`);
}

const defaultResolve = async (host: string) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
