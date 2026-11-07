import { activeKeyId, needsRewrap, rewrapSecret, sealedKeyId } from "./crypto";
import { listAllSealedSecrets, replaceSealedSecret } from "./store";

// Rotating the connector master key (D-40). Vercel has no shell, so this runs from the
// superadmin console: put the new key first in SAWWI_CONNECTOR_KEYS, redeploy, re-wrap here,
// then remove the old key once nothing uses it.

const aad = (orgKey: string, provider: string) => `sawwi:${orgKey}:${provider}`;

export type KeyringStatus = { activeKeyId?: string; byKey: { keyId: string; secrets: number; active: boolean }[]; needRewrap: number };

export async function keyringStatus(): Promise<KeyringStatus> {
  const active = activeKeyId();
  const counts = new Map<string, number>();
  for (const s of await listAllSealedSecrets()) counts.set(sealedKeyId(s.secretEnc), (counts.get(sealedKeyId(s.secretEnc)) ?? 0) + 1);
  const byKey = [...counts].map(([keyId, secrets]) => ({ keyId, secrets, active: keyId === active })).sort((a, b) => Number(b.active) - Number(a.active) || a.keyId.localeCompare(b.keyId));
  return { activeKeyId: active, byKey, needRewrap: byKey.filter((k) => !k.active).reduce((n, k) => n + k.secrets, 0) };
}

/** Re-seals every secret that isn't under the active key. Secrets no key on this server opens are left alone and counted. */
export async function rewrapAll(): Promise<{ rewrapped: number; failed: number }> {
  let rewrapped = 0;
  let failed = 0;
  for (const s of await listAllSealedSecrets()) {
    if (!needsRewrap(s.secretEnc)) continue;
    try {
      if (await replaceSealedSecret(s.id, s.secretEnc, rewrapSecret(s.secretEnc, aad(s.orgKey, s.provider)))) rewrapped++;
    } catch {
      failed++;
    }
  }
  return { rewrapped, failed };
}
