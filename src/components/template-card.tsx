import Link from "next/link";
import { FREQUENCY_LABELS, GROUP_LABELS, type Template } from "@/lib/templates/types";

export function TemplateCard({ template, dimmed = false }: { template: Template; dimmed?: boolean }) {
  return (
    <Link
      href={`/templates/${template.id}`}
      className={
        "group flex flex-col rounded-xl border border-border bg-surface p-5 transition hover:border-accent/60 hover:shadow-sm " +
        (dimmed ? "opacity-75 hover:opacity-100" : "")
      }
    >
      <div className="flex items-center gap-2 text-xs text-muted">
        <span>{GROUP_LABELS[template.group]}</span>
        <span aria-hidden>·</span>
        <span>{FREQUENCY_LABELS[template.frequency]}</span>
        {template.featured && (
          <span className="ml-auto rounded-full border border-border px-2 py-0.5 font-medium text-muted">Edge case</span>
        )}
      </div>
      <h3 className="mt-2 font-semibold tracking-tight group-hover:text-accent-strong">{template.title}</h3>
      <p className="mt-1.5 line-clamp-3 text-sm text-muted">{template.summary}</p>
      <div className="mt-auto flex flex-wrap gap-1.5 pt-4">
        {template.sources.map((s) => (
          <span key={s.key} className="rounded-md bg-surface-muted px-2 py-0.5 text-xs text-muted">
            {s.label}
          </span>
        ))}
      </div>
    </Link>
  );
}
