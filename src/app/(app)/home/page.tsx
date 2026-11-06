import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Pill } from "@/components/data-table";
import { PlusIcon } from "@/components/icons";
import { buttonClass } from "@/components/ui";
import type { Profile } from "@/lib/profile/profile";
import { getProfile } from "@/lib/profile/session";
import { orgKeyFor } from "@/lib/runs/access";
import { RUN_STATUS } from "@/lib/runs/status";
import { listRuns, type RunSummary } from "@/lib/runs/store";
import { getTemplate, TEMPLATES } from "@/lib/templates/catalog";
import { recommendTemplates } from "@/lib/templates/recommend";
import { FREQUENCY_LABELS, GROUP_LABELS } from "@/lib/templates/types";

export const metadata: Metadata = { title: "Home" };

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso));

export default function HomePage() {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <Home />
    </Suspense>
  );
}

async function Home() {
  const profile = await getProfile();
  if (!profile) return null;
  const runs = listRuns(orgKeyFor(profile));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-muted">{profile.company}</p>
        </div>
        <Link href="/templates" className={buttonClass("primary")}>
          <PlusIcon className="size-4" />
          New reconciliation
        </Link>
      </div>

      {runs.length === 0 ? <FirstRun profile={profile} /> : <Overview runs={runs} profile={profile} />}
    </div>
  );
}

function FirstRun({ profile }: { profile: Profile }) {
  const { recommended } = recommendTemplates(TEMPLATES, profile);
  return (
    <section className="mt-8 rounded-2xl border border-border bg-surface p-6 sm:p-8">
      <h2 className="text-lg font-semibold tracking-tight">Run your first reconciliation</h2>
      <p className="mt-1 max-w-xl text-sm text-muted">
        Pick one of these, upload the two files it asks for, answer a couple of one-click questions and you&apos;ll have a report in under a
        minute.
      </p>
      <ol className="mt-5 grid gap-2 text-sm text-muted sm:grid-cols-3">
        {["Pick a template", "Upload your files", "Review the exceptions"].map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-full border border-border text-xs font-semibold text-foreground">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {recommended.slice(0, 3).map((t) => (
          <TemplateCard key={t.id} id={t.id} />
        ))}
      </div>
    </section>
  );
}

function TemplateCard({ id }: { id: string }) {
  const t = getTemplate(id)!;
  return (
    <Link href={`/templates/${t.id}`} className="group flex flex-col rounded-xl border border-border bg-surface p-4 transition-colors hover:border-foreground/30">
      <span className="text-xs text-muted">
        {GROUP_LABELS[t.group]} · {FREQUENCY_LABELS[t.frequency]}
      </span>
      <span className="mt-1.5 font-medium leading-snug">{t.title}</span>
      <span className="mt-1 line-clamp-2 text-sm text-muted">{t.summary}</span>
      <span className="mt-3 text-sm font-medium text-muted group-hover:text-foreground">Open →</span>
    </Link>
  );
}

function Overview({ runs, profile }: { runs: RunSummary[]; profile: Profile }) {
  // Exceptions only count from the latest reconciled run of each template, so re-runs don't double up.
  const latest = new Map<string, RunSummary>();
  for (const r of runs) if (r.exceptions !== undefined && !latest.has(r.templateId)) latest.set(r.templateId, r);
  const open = [...latest.values()];
  const exceptions = open.reduce((s, r) => s + (r.exceptions ?? 0), 0);
  const currencies = new Set(open.map((r) => r.currency).filter(Boolean));
  const value = open.reduce((s, r) => s + (r.value ?? 0), 0);
  const inProgress = runs.filter((r) => r.status !== "done");

  const recommended = recommendTemplates(TEMPLATES, profile).recommended.filter((t) => !runs.some((r) => r.templateId === t.id));

  return (
    <>
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Reconciliations" value={runs.length.toLocaleString("en-US")} />
        <Stat label="In progress" value={inProgress.length.toLocaleString("en-US")} tone={inProgress.length ? "text-warn" : undefined} />
        <Stat label="Open exceptions" value={exceptions.toLocaleString("en-US")} tone={exceptions ? "text-danger" : "text-success"} hint="Latest run of each" />
        <Stat
          label="Value flagged"
          value={`${currencies.size === 1 ? `${[...currencies][0]} ` : ""}${money(value)}`}
          tone={value ? "text-danger" : "text-success"}
          hint={currencies.size > 1 ? "Mixed currencies" : "Latest run of each"}
        />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Recent reconciliations</h2>
            <Link href="/runs" className="text-sm text-muted hover:text-foreground">
              View all →
            </Link>
          </div>
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {runs.slice(0, 6).map((r) => {
              const status = RUN_STATUS[r.status];
              return (
                <li key={r.id}>
                  <Link href={`/runs/${r.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted/50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{getTemplate(r.templateId)?.title ?? r.templateId}</p>
                      <p className="text-xs text-muted">
                        Started {day(r.createdAt)} · {r.files} file{r.files === 1 ? "" : "s"}
                      </p>
                    </div>
                    {r.exceptions !== undefined && (
                      <span className={`tabular hidden text-sm font-medium sm:block ${r.exceptions ? "text-danger" : "text-success"}`}>
                        {r.exceptions ? `${r.exceptions.toLocaleString("en-US")} exceptions` : "Clean"}
                      </span>
                    )}
                    <Pill tone={status.tone}>{status.label}</Pill>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Suggested next</h2>
            <Link href="/templates" className="text-sm text-muted hover:text-foreground">
              All templates →
            </Link>
          </div>
          <div className="mt-3 space-y-3">
            {recommended.slice(0, 3).map((t) => (
              <TemplateCard key={t.id} id={t.id} />
            ))}
            {recommended.length === 0 && <p className="text-sm text-muted">You&apos;ve tried every template recommended for you.</p>}
          </div>
        </section>
      </div>
    </>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`tabular mt-1.5 truncate text-xl font-semibold tracking-tight ${tone ?? ""}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}
