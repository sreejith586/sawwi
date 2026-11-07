import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/marketing/json-ld";
import { Breadcrumbs, ClosingCta, Ctas } from "@/components/marketing/page-bits";
import { TemplateCard } from "@/components/marketing/template-details";
import { CONNECTOR_NAMES } from "@/lib/seo/coverage";
import { breadcrumbs, faqPage, softwareApplication } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/metadata";
import { SOLUTIONS, solutionBySlug } from "@/lib/seo/solutions";
import { TEMPLATES } from "@/lib/templates/catalog";

// One public page per system or payment flow (D-47). Static: built once per slug.
export const generateStaticParams = () => SOLUTIONS.map((s) => ({ slug: s.slug }));
// Every page is prerendered from generateStaticParams. The page reads params before rendering so an
// unknown one is a real 404 (notFound() inside a Suspense boundary could answer 200), which the
// dev-time instant-navigation check flags; opting out of that check doesn't change prerendering.
export const instant = false;

export async function generateMetadata({ params }: PageProps<"/reconciliation/[slug]">): Promise<Metadata> {
  const s = solutionBySlug((await params).slug);
  if (!s) return {};
  return pageMetadata({ title: s.title, description: s.description, path: `/reconciliation/${s.slug}` });
}

const STEPS = [
  ["Pick the reconciliation", "Each one knows which files it needs and what to check."],
  ["Add the files", "Upload exports as they are, or pull them from a connection. Columns are mapped for you and remembered."],
  ["Work the exceptions", "Every exception with its value, ranked by what it costs you, and every table downloads to Excel."],
] as const;

export default async function SolutionPage({ params }: PageProps<"/reconciliation/[slug]">) {
  const s = solutionBySlug((await params).slug);
  if (!s) notFound();
  const templates = s.templates.map((id) => TEMPLATES.find((t) => t.id === id)).filter((t) => t !== undefined);
  const trail = [
    { name: "Home", path: "/" },
    { name: "Reconciliations", path: "/reconciliation" },
    { name: s.name, path: `/reconciliation/${s.slug}` },
  ];
  const related = s.related.map(solutionBySlug).filter((r) => r !== undefined);

  return (
    <>
      <JsonLd data={breadcrumbs(trail)} />
      <JsonLd data={faqPage(s.faqs)} />
      <JsonLd data={softwareApplication(s.description)} />

      <section className="border-b border-border">
        <div className="mx-auto max-w-4xl px-4 pb-14 pt-10 sm:px-6">
          <Breadcrumbs items={trail} />
          <h1 className="mt-6 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">{s.h1}</h1>
          <p className="mt-5 max-w-2xl text-lg text-muted">{s.lede}</p>
          <Ctas />
        </div>
      </section>

      <section className="border-b border-border bg-surface">
        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">{s.dataIn.heading}</h2>
          {s.dataIn.connector && (
            <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted">
              <span aria-hidden className="size-1.5 rounded-full bg-info" />
              Read-only connector: {CONNECTOR_NAMES[s.dataIn.connector]}
            </p>
          )}
          <div className="mt-4 space-y-3 text-muted">
            {s.dataIn.paragraphs.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">
            {templates.length} {s.name} reconciliation{templates.length === 1 ? "" : "s"}
          </h2>
          <p className="mt-2 text-muted">Matching is done by Sawwi&apos;s own rules engine on keys, amounts and dates, never by AI, so the same files always give the same report.</p>
          <div className="mt-8 space-y-6">
            {templates.map((t) => (
              <TemplateCard key={t.id} template={t} />
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="rounded-2xl border border-border bg-background p-5">
                <span className="tabular grid size-7 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">{i + 1}</span>
                <h3 className="mt-3 font-semibold tracking-tight">{title}</h3>
                <p className="mt-1.5 text-sm text-muted">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">Questions</h2>
          <dl className="mt-6 divide-y divide-border rounded-2xl border border-border bg-surface">
            {s.faqs.map((f) => (
              <div key={f.q} className="p-5">
                <dt className="font-medium">{f.q}</dt>
                <dd className="mt-1.5 text-sm text-muted">{f.a}</dd>
              </div>
            ))}
          </dl>

          {related.length > 0 && (
            <>
              <h2 className="mt-14 text-lg font-semibold tracking-tight">Related reconciliations</h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {related.map((r) => (
                  <li key={r.slug}>
                    <Link href={`/reconciliation/${r.slug}`} className="inline-flex rounded-full border border-border px-3 py-1 text-sm text-muted hover:text-foreground">
                      {r.h1}
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
