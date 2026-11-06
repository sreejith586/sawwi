import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { startRun } from "@/app/actions/runs";
import { buttonClass } from "@/components/ui";
import { specRows } from "@/lib/tables/rows";
import { SpecTable } from "./spec-table";
import { getTemplate, TEMPLATES } from "@/lib/templates/catalog";
import { FREQUENCY_LABELS, GROUP_LABELS } from "@/lib/templates/types";

export function generateStaticParams() {
  return TEMPLATES.map((t) => ({ id: t.id }));
}

export async function generateMetadata(props: PageProps<"/templates/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  return { title: getTemplate(id)?.title ?? "Template" };
}

export default function TemplatePage(props: PageProps<"/templates/[id]">) {
  return (
    <Suspense fallback={<p className="text-muted">Loading template…</p>}>
      <TemplateDetail params={props.params} />
    </Suspense>
  );
}

async function TemplateDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const template = getTemplate(id);
  if (!template) notFound();

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/templates" className="text-sm text-muted hover:text-foreground">
        ← Templates
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{GROUP_LABELS[template.group]}</span>
            <span aria-hidden>·</span>
            <span>Usually run {FREQUENCY_LABELS[template.frequency].toLowerCase()}</span>
            {template.featured && <span className="rounded-full border border-border px-2 py-0.5 font-medium">Edge case</span>}
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{template.title}</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted">{template.summary}</p>
        </div>
        <form action={startRun.bind(null, template.id)}>
          <button type="submit" className={buttonClass("primary")}>
            Start reconciliation →
          </button>
        </form>
      </div>

      <section className="mt-10">
        <h2 className="text-sm font-semibold">Files you&apos;ll upload</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {template.sources.map((s, i) => (
            <div key={s.key} className="rounded-xl border border-border bg-surface p-5">
              <div className="flex items-start gap-3">
                <span className="tabular grid size-6 shrink-0 place-items-center rounded-full border border-border bg-surface-muted text-xs font-semibold text-muted">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">
                    {s.label}
                    {s.optional && <span className="ml-2 text-xs font-normal text-muted">Optional</span>}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{s.description}</p>
                  <p className="mt-3 text-xs text-muted">e.g. {s.examples.join(" · ")}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">Columns Sawwi looks for</h2>
          <p className="text-xs text-muted">Names don&apos;t need to match. Sawwi maps them and remembers next time.</p>
        </div>
        <SpecTable templateId={template.id} rows={specRows(template)} />
      </section>

      <section className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div>
          <h2 className="text-sm font-semibold">What Sawwi checks</h2>
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
            {template.checks.map((c) => (
              <li key={c.id} className="flex gap-3 p-4">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted" />
                <div>
                  <p className="text-sm font-medium">{c.label}</p>
                  <p className="mt-0.5 text-sm text-muted">{c.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-semibold">You get</h2>
          <ul className="mt-3 space-y-2">
            {template.outputs.map((o) => (
              <li key={o} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                {o}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
