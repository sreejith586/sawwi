import { describe, expect, it } from "vitest";
import { parseProfile, type Profile } from "@/lib/profile/profile";
import { TEMPLATES } from "./catalog";
import { recommendTemplates } from "./recommend";

const base: Profile = {
  company: "Acme Trading LLC",
  role: "finance",
  countries: ["AE"],
  accountingSystems: ["zoho"],
  channels: ["marketplace"],
  marketplaces: ["amazon_ae", "noon"],
  sellsB2B: false,
  usesMarketplaceFulfilment: false,
  platforms: [],
  payments: [],
  b2bPayments: [],
  givesCreditTerms: false,
};

const ids = (ts: { id: string }[]) => ts.map((t) => t.id);

describe("template catalogue", () => {
  it("has 24 templates with unique ids", () => {
    expect(TEMPLATES).toHaveLength(24);
    expect(new Set(ids(TEMPLATES)).size).toBe(24);
  });

  it("links only declared slots and fields", () => {
    for (const t of TEMPLATES) {
      const fields = new Map(t.sources.map((s) => [s.key, new Set(s.fields.map((f) => f.key))]));
      expect(t.links.length, t.id).toBeGreaterThan(0);
      for (const link of t.links) {
        expect(fields.has(link.left), `${t.id}: ${link.left}`).toBe(true);
        expect(fields.has(link.right), `${t.id}: ${link.right}`).toBe(true);
        for (const k of link.keys) {
          expect(fields.get(link.left), `${t.id}: ${link.left}.${k.left}`).toContain(k.left);
          expect(fields.get(link.right), `${t.id}: ${link.right}.${k.right}`).toContain(k.right);
        }
      }
    }
  });

  it("only uses fields that exist in amount expressions and check rules", () => {
    for (const t of TEMPLATES) {
      const all = new Set(t.sources.flatMap((s) => s.fields.map((f) => f.key)));
      const idents = (expr: string) => (expr.match(/[a-z_][a-z0-9_]*/g) ?? []).filter((w) => w !== "abs");
      for (const link of t.links) {
        if (!link.amount) continue;
        for (const id of [...idents(link.amount.left), ...idents(link.amount.right)]) expect(all, `${t.id}: ${id}`).toContain(id);
      }
      for (const c of t.checks) {
        const r = c.rule;
        if (!r) continue;
        if ("link" in r) expect(r.link, `${t.id}/${c.id}`).toBeLessThan(t.links.length);
        if (r.kind === "compare") {
          for (const id of [...idents(r.left ?? ""), ...idents(r.right ?? "")]) expect(all, `${t.id}/${c.id}: ${id}`).toContain(id);
          if (!r.left || !r.right) expect(t.links[r.link].amount, `${t.id}/${c.id}`).toBeDefined();
        }
        if ("field" in r && typeof r.field === "string") expect(all, `${t.id}/${c.id}`).toContain(r.field);
        if ("where" in r && r.where) expect(all, `${t.id}/${c.id}`).toContain(r.where.field);
      }
    }
  });
});

describe("recommendTemplates", () => {
  it("shows only marketplace templates to a marketplace-only seller", () => {
    const { recommended, others } = recommendTemplates(TEMPLATES, base);
    expect(ids(recommended)).toContain("mkt-settlement-vs-sales");
    expect(ids(recommended)).toContain("bank-payouts");
    expect(ids(recommended)).not.toContain("web-orders-vs-gateway");
    expect(recommended.length + others.length).toBe(TEMPLATES.length);
  });

  it("gates B2B and fulfilment templates on the yes/no answers", () => {
    const off = ids(recommendTemplates(TEMPLATES, base).recommended);
    expect(off).not.toContain("mkt-b2b-payment-release");
    expect(off).not.toContain("mkt-fulfilment-inventory");

    const on = ids(
      recommendTemplates(TEMPLATES, { ...base, sellsB2B: true, usesMarketplaceFulfilment: true }).recommended,
    );
    expect(on).toContain("mkt-b2b-payment-release");
    expect(on).toContain("mkt-fulfilment-inventory");
  });

  it("gates webstore payment templates on payment methods", () => {
    const webstore: Profile = { ...base, channels: ["webstore"], marketplaces: [], platforms: ["magento2"], payments: ["cod"] };
    const rec = ids(recommendTemplates(TEMPLATES, webstore).recommended);
    expect(rec).toContain("web-cod-remittance");
    expect(rec).not.toContain("web-orders-vs-gateway");
    expect(rec).not.toContain("web-bnpl");
  });

  it("shows direct B2B templates, gated on credit terms and cheque payments", () => {
    const b2b: Profile = { ...base, channels: ["b2b"], marketplaces: [], b2bPayments: ["bank_transfer"] };
    const plain = ids(recommendTemplates(TEMPLATES, b2b).recommended);
    expect(plain).toContain("b2b-cash-application");
    expect(plain).toContain("b2b-order-delivery-invoice");
    expect(plain).not.toContain("b2b-customer-statement");
    expect(plain).not.toContain("b2b-pdc-clearing");
    expect(plain).not.toContain("mkt-settlement-vs-sales");

    const withCredit = ids(
      recommendTemplates(TEMPLATES, { ...b2b, givesCreditTerms: true, b2bPayments: ["cheque"] }).recommended,
    );
    expect(withCredit).toContain("b2b-customer-statement");
    expect(withCredit).toContain("b2b-pdc-clearing");
  });

  it("gates purchasing templates on the supplier and import answers, defaulting to no", () => {
    const off = ids(recommendTemplates(TEMPLATES, base).recommended);
    expect(off).not.toContain("p2p-three-way-match");
    const buyer = ids(recommendTemplates(TEMPLATES, { ...base, buysFromSuppliers: true }).recommended);
    expect(buyer).toContain("p2p-three-way-match");
    expect(buyer).toContain("p2p-supplier-statement");
    expect(buyer).not.toContain("p2p-import-landed-cost");
    const importer = ids(recommendTemplates(TEMPLATES, { ...base, importsStock: true }).recommended);
    expect(importer).toContain("p2p-import-landed-cost");
    expect(parseProfile({ ...base }).profile?.buysFromSuppliers).toBe(false);
  });

  it("ranks templates owned by the user's role first", () => {
    const ops = recommendTemplates(TEMPLATES, { ...base, role: "marketplace_ops" }).recommended;
    expect(ops[0].roles[0]).toBe("marketplace_ops");
  });
});

describe("parseProfile", () => {
  it("drops webstore answers when the webstore channel is not selected", () => {
    const { profile } = parseProfile({ ...base, platforms: ["magento1"], payments: ["cod"] });
    expect(profile?.platforms).toEqual([]);
    expect(profile?.payments).toEqual([]);
  });

  it("rejects unknown option values and reports missing answers", () => {
    const { profile, errors } = parseProfile({ ...base, role: "ceo", channels: ["webstore"], platforms: ["bogus"] });
    expect(profile).toBeUndefined();
    expect(errors.role).toBeDefined();
    expect(errors.platforms).toBeDefined();
    expect(errors.payments).toBeDefined();
  });
});
