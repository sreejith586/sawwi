import { describe, expect, it } from "vitest";
import { CONNECTORS } from "@/lib/connectors/registry";
import { slotFit } from "@/lib/connectors/slot-fit";
import { TEMPLATES } from "@/lib/templates/catalog";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { CONNECTOR_COVERAGE, connectorsFor } from "./coverage";
import { faqPage, jsonLdString } from "./jsonld";
import { SOLUTIONS } from "./solutions";

describe("SEO pages (D-47)", () => {
  it("only claims connectors that have a report for that template's slot", () => {
    for (const [connectorId, templates] of Object.entries(CONNECTOR_COVERAGE)) {
      const connector = CONNECTORS.find((c) => c.id === connectorId);
      expect(connector, connectorId).toBeDefined();
      for (const [templateId, slots] of Object.entries(templates)) {
        const template = TEMPLATES.find((t) => t.id === templateId);
        expect(template, templateId).toBeDefined();
        for (const [slotKey, reportId] of Object.entries(slots)) {
          expect(template!.sources.some((s) => s.key === slotKey), `${templateId}/${slotKey}`).toBe(true);
          const report = connector!.reports.find((r) => r.id === reportId);
          expect(report, `${connectorId}:${reportId}`).toBeDefined();
          expect(slotFit(report!.slots, templateId, slotKey), `${connectorId}:${reportId} → ${templateId}/${slotKey}`).toBeGreaterThan(0);
        }
      }
    }
    expect(connectorsFor(TEMPLATES.find((t) => t.id === "p2p-three-way-match")!).map((c) => c.id)).toEqual(["business-central"]);
  });

  it("every page points at real templates, unique slugs, and short enough titles", () => {
    const slugs = new Set<string>();
    for (const s of SOLUTIONS) {
      expect(slugs.has(s.slug)).toBe(false);
      slugs.add(s.slug);
      for (const id of s.templates) expect(TEMPLATES.some((t) => t.id === id), `${s.slug}: ${id}`).toBe(true);
      for (const r of s.related) expect(SOLUTIONS.some((o) => o.slug === r), `${s.slug} → ${r}`).toBe(true);
      expect(`${s.title} · Sawwi`.length, s.slug).toBeLessThanOrEqual(65);
      expect(s.description.length, s.slug).toBeLessThanOrEqual(160);
      expect(s.faqs.length).toBeGreaterThan(0);
      expect(new Set(s.templates).size, `${s.slug}: a template listed twice`).toBe(s.templates.length);
      if (s.dataIn.connector) {
        expect(Object.keys(CONNECTOR_COVERAGE)).toContain(s.dataIn.connector);
        // A connector's page lists every template its connector fills.
        for (const id of Object.keys(CONNECTOR_COVERAGE[s.dataIn.connector])) expect(s.templates, `${s.slug} should list ${id}`).toContain(id);
      }
    }
    // The ones the brief named.
    for (const slug of ["magento-2", "dynamics-365-business-central", "shopify", "amazon-settlement", "noon-settlement", "bank", "payment-gateway", "cash-on-delivery", "bnpl"]) expect(slugs).toContain(slug);
  });

  it("keeps every template's summary short enough for its page description", () => {
    for (const t of TEMPLATES) expect(t.summary.length, t.id).toBeLessThanOrEqual(160);
  });

  it("never claims reviews, ratings or customers", () => {
    const text = JSON.stringify(SOLUTIONS).toLowerCase();
    for (const word of ["review", "rating", "trusted by", "customers love", "testimonial", "award"]) {
      // "review" appears only as "listed for review"/"to review": no reviews of Sawwi.
      if (word === "review") expect(text).not.toMatch(/\breviews\b|\breviewed by\b/);
      else expect(text).not.toContain(word);
    }
  });

  it("lists every public page in the sitemap on sawwiapp.ai, and keeps the app out of robots", () => {
    const urls = sitemap().map((u) => u.url);
    expect(urls).toContain("https://sawwiapp.ai/reconciliation/magento-2");
    expect(urls).toContain("https://sawwiapp.ai/reconciliation/dynamics-365-business-central");
    expect(urls.filter((u) => u.includes("/reconciliation-templates/"))).toHaveLength(TEMPLATES.length);
    expect(urls.every((u) => u.startsWith("https://sawwiapp.ai"))).toBe(true);
    const r = robots();
    expect(r.sitemap).toBe("https://sawwiapp.ai/sitemap.xml");
    expect(JSON.stringify(r.rules)).toContain("/runs");
  });

  it("escapes JSON-LD so it can't close its script tag", () => {
    const out = jsonLdString(faqPage([{ q: "</script><b>", a: "x" }]));
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out).mainEntity[0].name).toBe("</script><b>");
  });
});
