"use client";

import { useMemo, useState } from "react";
import { FilterSelect, SearchInput } from "@/components/data-table";
import { TemplateCard } from "@/components/template-card";
import { GROUP_LABELS, type Template, type TemplateGroup } from "@/lib/templates/types";

type Sort = "relevance" | "name" | "frequency";
const FREQ_ORDER: Record<Template["frequency"], number> = { daily: 0, per_settlement: 1, weekly: 2, monthly: 3 };

export function TemplateGallery({ recommended, others }: { recommended: Template[]; others: Template[] }) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<TemplateGroup | "all">("all");
  const [sort, setSort] = useState<Sort>("relevance");
  const [scope, setScope] = useState<"mine" | "all">("mine");

  const groups = useMemo(() => {
    const present = new Set([...recommended, ...(scope === "all" ? others : [])].map((t) => t.group));
    return (Object.keys(GROUP_LABELS) as TemplateGroup[]).filter((g) => present.has(g));
  }, [recommended, others, scope]);

  const filter = (list: Template[]) => {
    const needle = q.trim().toLowerCase();
    const out = list.filter(
      (t) =>
        (group === "all" || t.group === group) &&
        (!needle || [t.title, t.summary, ...t.sources.map((s) => s.label)].some((s) => s.toLowerCase().includes(needle))),
    );
    if (sort === "name") return [...out].sort((a, b) => a.title.localeCompare(b.title));
    if (sort === "frequency") return [...out].sort((a, b) => FREQ_ORDER[a.frequency] - FREQ_ORDER[b.frequency]);
    return out;
  };

  const mine = filter(recommended);
  const rest = scope === "all" ? filter(others) : [];

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Search templates or files" />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by group">
          {(["all", ...groups] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGroup(g)}
              className={
                "h-8 rounded-full border px-3 text-sm transition " +
                (group === g ? "border-foreground bg-foreground text-background" : "border-border bg-surface text-muted hover:text-foreground")
              }
            >
              {g === "all" ? "All" : GROUP_LABELS[g]}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <FilterSelect
            label="Show"
            value={scope}
            onChange={setScope}
            options={[
              { value: "mine", label: "For my business" },
              { value: "all", label: `All templates (${recommended.length + others.length})` },
            ]}
          />
          <FilterSelect
            label="Sort"
            value={sort}
            onChange={setSort}
            options={[
              { value: "relevance", label: "Most relevant" },
              { value: "name", label: "Name" },
              { value: "frequency", label: "How often" },
            ]}
          />
        </div>
      </div>

      <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Recommended for you · {mine.length}</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mine.map((t) => (
            <TemplateCard key={t.id} template={t} />
          ))}
        </div>
        {mine.length === 0 && <p className="mt-3 text-sm text-muted">No recommended templates match. Try “All templates”.</p>}
      </section>

      {scope === "all" && (
        <section className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Other templates · {rest.length}</h2>
          <p className="mt-1 text-sm text-muted">These don&apos;t match your profile, but you can still run them.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((t) => (
              <TemplateCard key={t.id} template={t} dimmed />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
