import { createCipheriv, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { activeKeyId, connectorsEnabled, decryptSecret, encryptSecret, masterKeys, needsRewrap, sealedKeyId } from "./crypto";
import { keyringStatus, rewrapAll } from "./keyring";
import * as store from "./store";

const env = process.env as Record<string, string | undefined>;
const k = () => randomBytes(32).toString("base64");
afterEach(() => {
  delete env.SAWWI_CONNECTOR_KEYS;
  delete env.SAWWI_CONNECTOR_KEY;
});

/** A secret sealed the D-28 way (v1: straight under the single key, no key id). */
function sealV1(key: string, plain: unknown, aad: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
  c.setAAD(Buffer.from(aad));
  const body = Buffer.concat([c.update(JSON.stringify(plain), "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

describe("connector key ring (D-40)", () => {
  it("reads a ring, active key first, and refuses a bad one", () => {
    env.SAWWI_CONNECTOR_KEYS = `k2:${k()}, k1:${randomBytes(32).toString("hex")}`;
    expect(masterKeys()?.map((m) => m.id)).toEqual(["k2", "k1"]);
    expect(activeKeyId()).toBe("k2");
    for (const bad of [`k2:${randomBytes(16).toString("base64")}`, `k2:${k()},k2:${k()}`, `no-colon`, `bad id:${k()}`]) {
      env.SAWWI_CONNECTOR_KEYS = bad;
      expect(connectorsEnabled()).toBe(false);
    }
    delete env.SAWWI_CONNECTOR_KEYS;
    env.SAWWI_CONNECTOR_KEY = k(); // the single key from before still works, as "k0"
    expect(activeKeyId()).toBe("k0");
  });

  it("seals with a fresh data key under the active key, bound to the workspace", () => {
    env.SAWWI_CONNECTOR_KEYS = `k1:${k()}`;
    const creds = { token: "shpat_test", store: "x.myshopify.com" };
    const sealed = encryptSecret(creds, "sawwi:acme:shopify");
    expect(sealed.split(".")).toHaveLength(8);
    expect(sealedKeyId(sealed)).toBe("k1");
    expect(sealed).not.toContain("shpat_test");
    expect(decryptSecret(sealed, "sawwi:acme:shopify")).toEqual(creds);
    expect(() => decryptSecret(sealed, "sawwi:other:shopify")).toThrow();
    expect(encryptSecret(creds, "x")).not.toBe(encryptSecret(creds, "x"));
    // Tampering with the wrapped data key or the key id is caught.
    const parts = sealed.split(".");
    expect(() => decryptSecret([...parts.slice(0, 4), parts[4].slice(0, -2) + "AA", ...parts.slice(5)].join("."), "sawwi:acme:shopify")).toThrow();
    expect(() => decryptSecret(["v2", "k9", ...parts.slice(2)].join("."), "sawwi:acme:shopify")).toThrow(/"k9"/);
  });

  it("still opens secrets sealed the old v1 way", () => {
    const old = k();
    const sealed = sealV1(old, { token: "t" }, "sawwi:acme:shopify");
    env.SAWWI_CONNECTOR_KEYS = `k1:${k()},k0:${old}`;
    expect(decryptSecret(sealed, "sawwi:acme:shopify")).toEqual({ token: "t" });
    expect(sealedKeyId(sealed)).toBe("v1");
    expect(needsRewrap(sealed)).toBe(true);
  });

  it("rotates: re-wraps every stored secret under the new key, after which the old key can go", async () => {
    const old = k();
    env.SAWWI_CONNECTOR_KEYS = `k1:${old}`;
    const a = await store.insertConnection({ orgKey: "acme", provider: "shopify", accountLabel: "A", secretEnc: encryptSecret({ token: "a" }, "sawwi:acme:shopify"), createdBy: null });
    await store.insertConnection({ orgKey: "beta", provider: "magento", accountLabel: "B", secretEnc: sealV1(old, { token: "b" }, "sawwi:beta:magento"), createdBy: null });
    // A secret no key opens (e.g. copied from another server) is reported, not destroyed.
    await store.insertConnection({ orgKey: "gamma", provider: "shopify", accountLabel: "C", secretEnc: sealV1(k(), { token: "c" }, "sawwi:gamma:shopify"), createdBy: null });

    const fresh = k();
    env.SAWWI_CONNECTOR_KEYS = `k2:${fresh},k1:${old}`;
    expect(await keyringStatus()).toMatchObject({ activeKeyId: "k2", needRewrap: 3 });
    expect(await rewrapAll()).toEqual({ rewrapped: 2, failed: 1 });
    expect((await keyringStatus()).byKey).toEqual([
      { keyId: "k2", secrets: 2, active: true },
      { keyId: "v1", secrets: 1, active: false },
    ]);

    env.SAWWI_CONNECTOR_KEYS = `k2:${fresh}`; // old key removed
    expect(decryptSecret(String(await store.getConnectionSecret("acme", a.id)), "sawwi:acme:shopify")).toEqual({ token: "a" });
    expect(await rewrapAll()).toEqual({ rewrapped: 0, failed: 1 });
  });
});
