import Link from "next/link";
import { automatedChecks, connectorsFor, reviewChecks } from "@/lib/seo/coverage";
import type { Template } from "@/lib/templates/types";

// What a template needs and what it checks, straight from its seeded spec (D-47), so public
// pages can't drift from what the engine actually does.

const Tick = () => (
  <svg aria-hidden viewBox="0 0 20 20" className="mt-0.5 size-4 shrink-0 text-success" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </svg>
);

export function TemplateFiles({ template, headingLevel = 3 }: { template: Template; headingLevel?: 2 | 3 | 4 }) {
  const H = `h${headingLevel}` as "h2" | "h3" | "h4";
  const connectors = connectorsFor(template);
  return (
    <div>
      <H className="text-sm font-semibold">Files you need</H>
      <ul className="mt-2 space-y-2 text-sm">
        {template.sources.map((s) => (
          <li key={s.key}>
            <span className="font-medium">{s.label}</span>
            {s.optional && <span className="ml-1.5 text-muted">(optional)</span>}
            <span className="text-muted">: {s.description}</span>
            {s.examples.length > 0 && <span className="block text-xs text-muted">For example: {s.examples.slice(0, 4).join(", ")}.</span>}
          </li>
        ))}
      </ul>
      {connectors.length > 0 && (
        <p className="mt-3 text-sm text-muted">
          {connectors.map((c, i) => (
            <span key={c.id}>
              {i > 0 && " "}
              The {c.name} connector can fill: {c.slots.join(", ")}.
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

export function TemplateChecks({ template, headingLevel = 3 }: { template: Template; headingLevel?: 2 | 3 | 4 }) {
  const H = `h${headingLevel}` as "h2" | "h3" | "h4";
  const auto = automatedChecks(template);
  const review = reviewChecks(template);
  return (
    <div>
      <H className="text-sm font-semibold">What Sawwi checks</H>
      <ul className="mt-2 space-y-2 text-sm">
        {auto.map((c) => (
          <li key={c.id} className="flex gap-2">
            <Tick />
            <span>
              <span className="font-medium">{c.label}</span>
              <span className="text-muted">: {c.description}</span>
            </span>
          </li>
        ))}
      </ul>
      {review.length > 0 && (
        <p className="mt-3 text-sm text-muted">
          Listed for you to review (not calculated automatically yet): {review.map((c) => c.label.toLowerCase()).join("; ")}.
        </p>
      )}
    </div>
  );
}

export function TemplateCard({ template }: { template: Template }) {
  return (
    <article className="rounded-2xl border border-border bg-surface p-6">
      <h3 className="text-lg font-semibold tracking-tight">
        <Link href={`/reconciliation-templates/${template.id}`} className="hover:underline">
          {template.title}
        </Link>
      </h3>
      <p className="mt-1.5 text-sm text-muted">{template.summary}</p>
      <div className="mt-5 grid gap-6 md:grid-cols-2">
        <TemplateFiles template={template} headingLevel={4} />
        <TemplateChecks template={template} headingLevel={4} />
      </div>
    </article>
  );
}
