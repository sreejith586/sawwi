import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/marketing/json-ld";
import { Breadcrumbs, ClosingCta, Ctas } from "@/components/marketing/page-bits";
import { breadcrumbs, softwareApplication } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/metadata";
import { SOLUTIONS } from "@/lib/seo/solutions";
import { TEMPLATES } from "@/lib/templates/catalog";

const DESCRIPTION = "Reconciliation for Magento 2, Shopify, Business Central, Amazon and Noon settlements, payment gateways, COD, Tabby and Tamara, and bank statements.";

export const metadata: Metadata = pageMetadata({ title: "E-commerce reconciliation by system", description: DESCRIPTION, path: "/reconciliation" });

export default function ReconciliationHub() {
  const trail = [
    { name: "Home", path: "/" },
    { name: "Reconciliations", path: "/reconciliation" },
  ];
  return (
    <>
      <JsonLd data={breadcrumbs(trail)} />
      <JsonLd data={softwareApplication(DESCRIPTION)} />
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 pb-14 pt-10 sm:px-6">
          <Breadcrumbs items={trail} />
          <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">Reconciliations for how you sell and get paid</h1>
          <p className="mt-5 max-w-2xl text-lg text-muted">
            Pick your store, ERP, marketplace or payment method to see which files Sawwi needs and what it checks. All {TEMPLATES.length} reconciliations are in the{" "}
            <Link href="/reconciliation-templates" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
              template catalogue
            </Link>
            .
          </p>
          <Ctas />
        </div>
      </section>
      <section>
        <div className="mx-auto grid max-w-6xl gap-4 px-4 py-14 sm:px-6 md:grid-cols-2 lg:grid-cols-3">
          {SOLUTIONS.map((s) => (
            <Link key={s.slug} href={`/reconciliation/${s.slug}`} className="group rounded-2xl border border-border bg-surface p-6 transition-colors hover:border-foreground/30">
              <h2 className="font-semibold tracking-tight group-hover:underline">{s.h1}</h2>
              <p className="mt-2 text-sm text-muted">{s.lede}</p>
              <p className="mt-4 text-xs text-muted">
                {s.dataIn.connector ? "Connector or upload" : "Upload"} · {s.templates.length} reconciliation{s.templates.length === 1 ? "" : "s"}
              </p>
            </Link>
          ))}
        </div>
      </section>
      <ClosingCta />
    </>
  );
}
