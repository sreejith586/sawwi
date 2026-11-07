import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Connection secrets are encrypted at rest (D-28), with envelope encryption and named, rotatable
// master keys (D-40):
// - each secret gets its own random 256-bit data key, which encrypts it with AES-256-GCM;
// - the data key is itself encrypted ("wrapped") by a master key, named by an id;
// - master keys come from SAWWI_CONNECTOR_KEYS ("id:key,id:key", 32 bytes each, base64 or hex,
//   the first one active), or the older single SAWWI_CONNECTOR_KEY (id "k0").
// Rotating means adding a new key in front, re-wrapping (Admin → Security), then dropping the old
// one. The workspace and provider are bound in as associated data, so a secret copied to another
// workspace won't decrypt. A cloud KMS can later replace the env keys as another KeyProvider.

export type MasterKey = { id: string; key: Buffer };

function parseKey(raw: string): Buffer | undefined {
  const s = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(s) ? Buffer.from(s, "hex") : Buffer.from(s, "base64");
  return key.length === 32 ? key : undefined;
}

/** Master keys, active first. An entry that isn't a valid 32-byte key makes the whole ring invalid. */
export function masterKeys(): MasterKey[] | undefined {
  const ring = process.env.SAWWI_CONNECTOR_KEYS?.trim();
  if (ring) {
    const keys: MasterKey[] = [];
    for (const entry of ring.split(",").map((e) => e.trim()).filter(Boolean)) {
      const at = entry.indexOf(":");
      const id = entry.slice(0, at).trim();
      const key = at > 0 ? parseKey(entry.slice(at + 1)) : undefined;
      if (!/^[\w-]{1,32}$/.test(id) || !key || keys.some((k) => k.id === id)) return undefined;
      keys.push({ id, key });
    }
    return keys.length ? keys : undefined;
  }
  const single = process.env.SAWWI_CONNECTOR_KEY?.trim();
  const key = single ? parseKey(single) : undefined;
  return key ? [{ id: "k0", key }] : undefined;
}

export const connectorsEnabled = () => masterKeys() !== undefined;
export const activeKeyId = () => masterKeys()?.[0].id;

function requireKeys(): MasterKey[] {
  const keys = masterKeys();
  if (!keys) throw new Error("SAWWI_CONNECTOR_KEYS (or SAWWI_CONNECTOR_KEY) is missing or invalid: each key must be 32 bytes.");
  return keys;
}

const b64 = (b: Buffer) => b.toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url");

function seal(key: Buffer, plain: Buffer, aad: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return [b64(iv), b64(cipher.getAuthTag()), b64(body)];
}

function open(key: Buffer, iv: string, tag: string, body: string, aad: string): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, unb64(iv));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(unb64(tag));
  return Buffer.concat([decipher.update(unb64(body)), decipher.final()]);
}

/** `v2.<keyId>.<wrapIv>.<wrapTag>.<wrappedDataKey>.<iv>.<tag>.<ciphertext>`, base64url parts. */
export function encryptSecret(plain: unknown, aad: string): string {
  const master = requireKeys()[0];
  const dataKey = randomBytes(32);
  const wrapped = seal(master.key, dataKey, `wrap:${master.id}:${aad}`);
  const sealed = seal(dataKey, Buffer.from(JSON.stringify(plain), "utf8"), aad);
  return ["v2", master.id, ...wrapped, ...sealed].join(".");
}

export function decryptSecret<T>(sealed: string, aad: string): T {
  const keys = requireKeys();
  const parts = sealed.split(".");
  if (parts[0] === "v2" && parts.length === 8) {
    const [, keyId, wIv, wTag, wBody, iv, tag, body] = parts;
    const master = keys.find((k) => k.id === keyId);
    if (!master) throw new Error(`This connection was encrypted with key "${keyId}", which this server doesn't have.`);
    const dataKey = open(master.key, wIv, wTag, wBody, `wrap:${keyId}:${aad}`);
    return JSON.parse(open(dataKey, iv, tag, body, aad).toString("utf8")) as T;
  }
  // v1 (D-28): sealed directly with the single key, which carried no id. Try each key.
  if (parts[0] === "v1" && parts.length === 4) {
    const [, iv, tag, body] = parts;
    for (const { key } of keys) {
      try {
        return JSON.parse(open(key, iv, tag, body, aad).toString("utf8")) as T;
      } catch {
        // wrong key: try the next
      }
    }
    throw new Error("No key on this server opens this connection's secret.");
  }
  throw new Error("Unreadable connection secret.");
}

/** The master key id a secret is sealed under ("v1" for the old single-key format). */
export function sealedKeyId(sealed: string): string {
  const [version, keyId] = sealed.split(".");
  return version === "v2" ? keyId : "v1";
}

/** True when the secret should be re-sealed under the active key. */
export const needsRewrap = (sealed: string) => sealedKeyId(sealed) !== activeKeyId();

/** Re-seals a secret under the active master key (a fresh data key too). */
export function rewrapSecret(sealed: string, aad: string): string {
  return encryptSecret(decryptSecret<unknown>(sealed, aad), aad);
}
