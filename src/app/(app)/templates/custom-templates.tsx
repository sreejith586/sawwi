import { deleteTemplate } from "@/app/actions/insights";
import { startRun } from "@/app/actions/runs";
import { buttonClass } from "@/components/ui";
import type { Template } from "@/lib/templates/types";

// Templates this workspace saved from custom reconciliations, shown above the catalogue.
export function CustomTemplates({ templates }: { templates: Template[] }) {
  if (templates.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Your templates · {templates.length}</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => (
          <div key={t.id} className="flex flex-col rounded-xl border border-border bg-surface p-5">
            <p className="text-xs text-muted">Saved by your team · tolerance ± {t.links[0]?.amount?.tolerance ?? 0}</p>
            <h3 className="mt-2 font-semibold tracking-tight">{t.title}</h3>
            <p className="mt-1.5 line-clamp-3 text-sm text-muted">{t.summary}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {t.sources.map((s) => (
                <span key={s.key} className="rounded-md bg-surface-muted px-2 py-0.5 text-xs text-muted">
                  {s.label}
                </span>
              ))}
            </div>
            <div className="mt-auto flex items-center gap-2 pt-4">
              <form action={startRun.bind(null, t.id)}>
                <button type="submit" className={buttonClass("primary")}>
                  Start →
                </button>
              </form>
              <form action={deleteTemplate.bind(null, t.id)} className="ml-auto">
                <button type="submit" className="text-xs font-medium text-muted hover:text-danger">
                  Delete
                </button>
              </form>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
