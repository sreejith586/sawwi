import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/marketing/json-ld";
import { Breadcrumbs, ClosingCta, Ctas } from "@/components/marketing/page-bits";
import { TemplateChecks, TemplateFiles } from "@/components/marketing/template-details";
import { breadcrumbs } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/metadata";
import { SOLUTIONS } from "@/lib/seo/solutions";
import { TEMPLATES } from "@/lib/templates/catalog";
import { FREQUENCY_LABELS, GROUP_LABELS } from "@/lib/templates/types";

// One public page per seeded template (D-47), built from its spec.
export const generateStaticParams = () => TEMPLATES.map((t) => ({ id: t.id }));
// Every page is prerendered from generateStaticParams. The page reads params before rendering so an
// unknown one is a real 404 (notFound() inside a Suspense boundary could answer 200), which the
// dev-time instant-navigation check flags; opting out of that check doesn't change prerendering.
export const instant = false;

const find = (id: string) => TEMPLATES.find((t) => t.id === id);

export async function generateMetadata({ params }: PageProps<"/reconciliation-templates/[id]">): Promise<Metadata> {
  const t = find((await params).id);
  if (!t) return {};
  // Long titles stay as they are; short ones get "reconciliation" for search.
  const title = t.title.length > 42 ? t.title : `${t.title} reconciliation`;
  return pageMetadata({ title, description: t.summary, path: `/reconciliation-templates/${t.id}` });
}

export default async function TemplatePage({ params }: PageProps<"/reconciliation-templates/[id]">) {
  const t = find((await params).id);
  if (!t) notFound();
  const trail = [
    { name: "Home", path: "/" },
    { name: "Template catalogue", path: "/reconciliation-templates" },
    { name: t.title, path: `/reconciliation-templates/${t.id}` },
  ];
  const usedOn = SOLUTIONS.filter((s) => s.templates.includes(t.id));
  return (
    <>
      <JsonLd data={breadcrumbs(trail)} />
      <section className="border-b border-border">
        <div className="mx-auto max-w-4xl px-4 pb-12 pt-10 sm:px-6">
          <Breadcrumbs items={trail} />
          <p className="mt-6 text-sm text-muted">
            {GROUP_LABELS[t.group]} · {FREQUENCY_LABELS[t.frequency]}
          </p>
          <h1 className="mt-2 text-4xl font-semibold leading-[1.1] tracking-tight">{t.title}</h1>
          <p className="mt-4 max-w-2xl text-lg text-muted">{t.summary}</p>
          <Ctas />
        </div>
      </section>
      <section>
        <div className="mx-auto grid max-w-4xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-2">
          <TemplateFiles template={t} headingLevel={2} />
          <TemplateChecks template={t} headingLevel={2} />
        </div>
      </section>
      <section className="border-t border-border bg-surface">
        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
          <h2 className="text-lg font-semibold tracking-tight">What you get</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {[...t.outputs, "Excel download of every table"].map((o) => (
              <li key={o} className="rounded-full border border-border bg-background px-3 py-1 text-sm text-muted">
                {o}
              </li>
            ))}
          </ul>
          {usedOn.length > 0 && (
            <>
              <h2 className="mt-10 text-lg font-semibold tracking-tight">Used for</h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {usedOn.map((s) => (
                  <li key={s.slug}>
                    <Link href={`/reconciliation/${s.slug}`} className="inline-flex rounded-full border border-border bg-background px-3 py-1 text-sm text-muted hover:text-foreground">
                      {s.h1}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
      <ClosingCta />
    </>
  );
}
