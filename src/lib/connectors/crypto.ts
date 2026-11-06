import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Connection secrets are encrypted at rest with AES-256-GCM (D-28). The key comes from
// SAWWI_CONNECTOR_KEY: 32 bytes, base64 or hex (`openssl rand -base64 32`). Without it,
// connections can't be added. Production moves the key to a KMS (envelope encryption).

const VERSION = "v1";

export function connectorKey(): Buffer | undefined {
  const raw = process.env.SAWWI_CONNECTOR_KEY?.trim();
  if (!raw) return undefined;
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  return key.length === 32 ? key : undefined;
}

export const connectorsEnabled = () => connectorKey() !== undefined;

function requireKey(): Buffer {
  const key = connectorKey();
  if (!key) throw new Error("SAWWI_CONNECTOR_KEY is missing or not 32 bytes.");
  return key;
}

/** `v1.<iv>.<tag>.<ciphertext>`, base64url parts. The workspace key is bound in as AAD. */
export function encryptSecret(plain: unknown, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", requireKey(), iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(JSON.stringify(plain), "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function decryptSecret<T>(sealed: string, aad: string): T {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || !body) throw new Error("Unreadable connection secret.");
  const decipher = createDecipheriv("aes-256-gcm", requireKey(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8")) as T;
}
