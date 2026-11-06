import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { startRun } from "@/app/actions/runs";
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
    <div className="mx-auto max-w-4xl">
      <Link href="/templates" className="text-sm text-muted hover:text-foreground">
        ← All templates
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>{GROUP_LABELS[template.group]}</span>
        <span aria-hidden>·</span>
        <span>Usually run: {FREQUENCY_LABELS[template.frequency]}</span>
        {template.featured && (
          <span className="rounded-full bg-warn-soft px-2 py-0.5 font-medium text-warn">Edge case</span>
        )}
      </div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{template.title}</h1>
      <p className="mt-2 max-w-2xl text-muted">{template.summary}</p>

      <section className="mt-8">
        <h2 className="font-semibold">Files you&apos;ll upload</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {template.sources.map((s, i) => (
            <div key={s.key} className="rounded-xl border border-border bg-surface p-5">
              <div className="flex items-center gap-2">
                <span className="grid size-6 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent-strong">
                  {i + 1}
                </span>
                <h3 className="font-medium">{s.label}</h3>
              </div>
              <p className="mt-2 text-sm text-muted">{s.description}</p>
              <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted">Typical exports</p>
              <ul className="mt-1 list-inside list-disc text-sm text-muted">
                {s.examples.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted">Columns Sawwi looks for</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {s.fields.map((f) => (
                  <span
                    key={f.key}
                    className={
                      "rounded-md px-2 py-0.5 text-xs " +
                      (f.required ? "bg-accent-soft text-accent-strong" : "bg-surface-muted text-muted")
                    }
                  >
                    {f.label}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          Highlighted columns are required. Column names don&apos;t need to match: Sawwi maps them for you and
          remembers the mapping for next time.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="font-semibold">What Sawwi checks</h2>
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
          {template.checks.map((c) => (
            <li key={c.id} className="p-4">
              <p className="text-sm font-medium">{c.label}</p>
              <p className="mt-0.5 text-sm text-muted">{c.description}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="font-semibold">You get</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {template.outputs.map((o) => (
            <li key={o} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm">
              {o}
            </li>
          ))}
        </ul>
      </section>

      <form action={startRun.bind(null, template.id)} className="mt-10 flex flex-wrap items-center gap-3 border-t border-border pt-6">
        <button
          type="submit"
          className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-strong"
        >
          Start reconciliation
        </button>
        <span className="text-sm text-muted">Upload your files on the next screen. Nothing runs until you say so.</span>
      </form>
    </div>
  );
}
