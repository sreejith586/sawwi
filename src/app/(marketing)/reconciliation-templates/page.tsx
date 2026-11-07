import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/marketing/json-ld";
import { Breadcrumbs, ClosingCta, Ctas } from "@/components/marketing/page-bits";
import { connectorsFor } from "@/lib/seo/coverage";
import { breadcrumbs } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/metadata";
import { appUrl } from "@/lib/site";
import { TEMPLATES } from "@/lib/templates/catalog";
import { FREQUENCY_LABELS, GROUP_LABELS, type TemplateGroup } from "@/lib/templates/types";

const DESCRIPTION = `${TEMPLATES.length} ready-made reconciliations for e-commerce sellers: marketplace settlements, webstore payments, COD, BNPL, B2B, purchasing and bank.`;

export const metadata: Metadata = pageMetadata({ title: "Reconciliation template catalogue", description: DESCRIPTION, path: "/reconciliation-templates" });

const ORDER: TemplateGroup[] = ["marketplace", "webstore", "payouts", "b2b", "purchasing"];

export default function TemplateCatalogue() {
  const trail = [
    { name: "Home", path: "/" },
    { name: "Template catalogue", path: "/reconciliation-templates" },
  ];
  return (
    <>
      <JsonLd data={breadcrumbs(trail)} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "Sawwi reconciliation templates",
          itemListElement: TEMPLATES.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.title, url: `${appUrl()}/reconciliation-templates/${t.id}` })),
        }}
      />
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 pb-14 pt-10 sm:px-6">
          <Breadcrumbs items={trail} />
          <h1 className="mt-6 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">Reconciliation template catalogue</h1>
          <p className="mt-5 max-w-2xl text-lg text-muted">
            Every reconciliation Sawwi runs out of the box. Each template knows the files it needs, how to match them and what to check. Don&apos;t see
            yours? Start a custom two-file reconciliation and save it as your own template.
          </p>
          <Ctas />
        </div>
      </section>
      <div className="mx-auto max-w-6xl space-y-14 px-4 py-14 sm:px-6">
        {ORDER.map((group) => {
          const list = TEMPLATES.filter((t) => t.group === group);
          if (list.length === 0) return null;
          return (
            <section key={group} aria-labelledby={`g-${group}`}>
              <h2 id={`g-${group}`} className="text-2xl font-semibold tracking-tight">
                {GROUP_LABELS[group]}
              </h2>
              <ul className="mt-6 grid gap-4 md:grid-cols-2">
                {list.map((t) => (
                  <li key={t.id}>
                    <Link href={`/reconciliation-templates/${t.id}`} className="group block h-full rounded-2xl border border-border bg-surface p-5 transition-colors hover:border-foreground/30">
                      <h3 className="font-semibold tracking-tight group-hover:underline">{t.title}</h3>
                      <p className="mt-1.5 text-sm text-muted">{t.summary}</p>
                      <p className="mt-3 text-xs text-muted">
                        {FREQUENCY_LABELS[t.frequency]} · {t.sources.length} files
                        {connectorsFor(t).length > 0 && ` · connector: ${connectorsFor(t).map((c) => c.name.split(" /")[0].replace("Microsoft Dynamics 365 ", "")).join(", ")}`}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <ClosingCta />
    </>
  );
}
