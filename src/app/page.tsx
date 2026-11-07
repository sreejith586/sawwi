import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { MarketingHeader } from "@/components/marketing/header";
import { TryDemoButton } from "@/components/demo/try-demo";
import { buttonClass } from "@/components/ui";
import { demoEnabled } from "@/lib/demo/enabled";
import { PLANS } from "@/lib/saas/plans";
import { getSettings } from "@/lib/saas/store";
import { TEMPLATES } from "@/lib/templates/catalog";
import { GROUP_LABELS, type TemplateGroup } from "@/lib/templates/types";

export const metadata: Metadata = {
  title: { absolute: "Sawwi · Reconciliation for GCC e-commerce sellers" },
  description:
    "Match marketplace settlements, gateway payouts, COD remittances and B2B payments against your orders and invoices in minutes. Built for sellers in the UAE, Saudi Arabia and the GCC.",
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: "Sawwi", url: "/" },
};

// Public intro page. Everything is static except the header's sign-in state and the
// pricing block (which depends on whether the superadmin has switched the paywall on).

const CHANNELS = ["Amazon.ae", "Amazon.sa", "Noon", "Namshi", "Trendyol", "Shopify", "Magento", "WooCommerce", "Salla", "Zid", "Tabby", "Tamara"];

const FEATURES = [
  {
    title: "Templates for the reconciliations you actually do",
    body: "Marketplace settlements, gateway payouts, COD remittances, BNPL, customer statements, post-dated cheques. Pick one and Sawwi knows which files it needs and what to check.",
    icon: "M4 4h5v5H4zM11 4h5v5h-5zM4 11h5v5H4zM11 11h5v5h-5z",
  },
  {
    title: "Upload any export as it is",
    body: "CSV or Excel straight from Seller Central, Shopify, your bank or your ERP. Sawwi maps the columns for you and remembers the layout next time.",
    icon: "M10 13V4M6.5 7.5 10 4l3.5 3.5M4 13v2.5h12V13",
  },
  {
    title: "One-click questions, not settings screens",
    body: "When something is ambiguous (is 03/04 March or April? which column is the order ID?) Sawwi asks once, with buttons, and never asks again.",
    icon: "M4.5 4h11A1.5 1.5 0 0 1 17 5.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 2.5V14h-1A1.5 1.5 0 0 1 3 12.5v-7A1.5 1.5 0 0 1 4.5 4Z",
  },
  {
    title: "Exact matching you can audit",
    body: "A deterministic engine matches every row on keys, amounts and dates with tolerances you can see. AI only helps read column headers; it never decides a match.",
    icon: "m4.5 10.5 3.5 3.5 7.5-8",
  },
  {
    title: "Exceptions ranked by what they cost you",
    body: "Unpaid orders, short payouts, duplicate charges and missing refunds, colour-coded by severity with the value at stake, so you chase the money first.",
    icon: "M10 3.5 2.5 16.5h15L10 3.5ZM10 8.5v3.5M10 14.2v.1",
  },
  {
    title: "Everything downloads to Excel",
    body: "Every table, filtered and sorted the way you see it, exports to a formatted workbook your auditor or marketplace account manager can open.",
    icon: "M5 3.5h7l3 3v10H5zM12 3.5v3h3M7.5 10l5 4M12.5 10l-5 4",
  },
];

const STEPS = [
  { title: "Pick a template", body: "Sawwi suggests the reconciliations that fit how you sell, from a two-minute setup." },
  { title: "Drop in your files", body: "Columns are mapped automatically. Answer a couple of one-click questions if anything is unclear." },
  { title: "Work the exceptions", body: "See matched, short and missing items with amounts in AED or SAR, and export the list to Excel." },
];

export default function LandingPage() {
  const groups = Object.entries(
    TEMPLATES.reduce<Record<string, typeof TEMPLATES>>((acc, t) => ((acc[t.group] ??= []).push(t), acc), {}),
  ) as [TemplateGroup, typeof TEMPLATES][];

  return (
    <div className="min-h-dvh">
      <MarketingHeader />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_30rem_at_50%_-10%,var(--surface-muted),transparent)]"
        />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:items-center">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
              <span className="size-1.5 rounded-full bg-success" aria-hidden />
              Built for sellers in the UAE, Saudi Arabia and the GCC
            </p>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
              Know where every dirham of your sales went.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted">
              Sawwi reconciles marketplace settlements, gateway payouts, COD remittances and B2B payments against your orders and invoices in
              minutes, and shows you exactly what&apos;s missing.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className={`${buttonClass("primary")} h-11 px-5 text-[15px]`}>
                Start free
              </Link>
              {demoEnabled() ? (
                <TryDemoButton className="h-11 px-5 text-[15px]" />
              ) : (
                <a href="#how" className={`${buttonClass("secondary")} h-11 px-5 text-[15px]`}>
                  See how it works
                </a>
              )}
            </div>
            <p className="mt-4 text-sm text-muted">No card needed. Set up in two minutes{demoEnabled() ? ", or try the demo store with invented data first, no sign-up." : "."}</p>
          </div>
          <ProductPreview />
        </div>
      </section>

      {/* Channels */}
      <section className="border-b border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <p className="text-center text-xs font-medium uppercase tracking-wide text-muted">Works with exports from</p>
          <ul className="mt-4 flex flex-wrap justify-center gap-2">
            {CHANNELS.map((c) => (
              <li key={c} className="rounded-full border border-border px-3 py-1 text-sm text-muted">
                {c}
              </li>
            ))}
            <li className="rounded-full border border-dashed border-border px-3 py-1 text-sm text-muted">your bank and ERP</li>
          </ul>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-16">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <SectionHeading eyebrow="Features" title="Reconciliation without the spreadsheet gymnastics" body="Everything a finance or e-commerce ops team needs to close the month on online sales." />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-border bg-surface p-6">
                <span className="grid size-9 place-items-center rounded-lg border border-border bg-surface-muted">
                  <svg aria-hidden viewBox="0 0 20 20" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d={f.icon} />
                  </svg>
                </span>
                <h3 className="mt-4 font-semibold tracking-tight">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-16 border-y border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <SectionHeading eyebrow="How it works" title="From raw exports to a clean report in three steps" />
          <ol className="mt-12 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative rounded-2xl border border-border bg-background p-6">
                <span className="tabular grid size-8 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">{i + 1}</span>
                <h3 className="mt-4 font-semibold tracking-tight">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Templates */}
      <section id="templates" className="scroll-mt-16">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <SectionHeading
            eyebrow="Templates"
            title={`${TEMPLATES.length} reconciliations ready on day one`}
            body="Marketplace, own webstore, direct B2B and purchasing. Each one knows the files, the matching rules and the checks."
          />
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {groups.map(([group, list]) => (
              <div key={group} className="rounded-2xl border border-border bg-surface p-6">
                <h3 className="text-sm font-semibold">{GROUP_LABELS[group]}</h3>
                <ul className="mt-3 space-y-2">
                  {list.map((t) => (
                    <li key={t.id} className="flex items-start gap-2 text-sm">
                      <svg aria-hidden viewBox="0 0 20 20" className="mt-0.5 size-4 shrink-0 text-success" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m4.5 10.5 3.5 3.5 7.5-8" />
                      </svg>
                      <span>
                        {t.title}
                        {t.featured && <span className="ml-2 rounded-full border border-border px-1.5 py-px text-[11px] text-muted">Edge case</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="border-y border-border bg-surface">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 md:grid-cols-3">
          {[
            { title: "Your numbers stay yours", body: "AI only sees column headers and a few sample values to map a file. Matching runs on Sawwi's own engine." },
            { title: "Same answer every time", body: "Rules are deterministic, so a re-run on the same files gives the same report: easy to review and audit." },
            { title: "GCC-ready", body: "VAT at 5% and 15%, AED, SAR and other GCC currencies, cash on delivery, Tabby and Tamara built in." },
          ].map((t) => (
            <div key={t.title}>
              <h3 className="font-semibold tracking-tight">{t.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{t.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-16">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <SectionHeading eyebrow="Pricing" title="Start free, upgrade when it pays for itself" />
          <Suspense fallback={<div className="mt-12 h-48 rounded-2xl border border-border bg-surface" />}>
            <Pricing />
          </Suspense>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 pb-20 sm:px-6">
        <div className="mx-auto max-w-6xl rounded-3xl bg-accent px-6 py-14 text-center text-accent-foreground sm:px-12">
          <h2 className="text-3xl font-semibold tracking-tight">Close this month&apos;s books with every payout accounted for.</h2>
          <p className="mx-auto mt-3 max-w-xl opacity-75">Set up takes two minutes. Bring last month&apos;s exports and see what you&apos;ve been missing.</p>
          <Link
            href="/signup"
            className="mt-8 inline-flex h-11 items-center rounded-lg bg-background px-5 text-[15px] font-medium text-foreground shadow-sm transition-opacity hover:opacity-90"
          >
            Create your workspace
          </Link>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted sm:px-6">
          <span className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-md bg-accent text-[11px] font-bold text-accent-foreground">S</span>
            Sawwi
          </span>
          <nav className="flex gap-5">
            <a href="#features" className="hover:text-foreground">
              Features
            </a>
            <a href="#pricing" className="hover:text-foreground">
              Pricing
            </a>
            <Link href="/login" className="hover:text-foreground">
              Log in
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function SectionHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight">{title}</h2>
      {body && <p className="mt-3 text-muted">{body}</p>}
    </div>
  );
}

/** A static, illustrative report card (sample numbers, not customer data). */
function ProductPreview() {
  const rows = [
    { label: "Order paid, never settled", tone: "text-danger", dot: "bg-danger", count: 14, value: "AED 6,420.00" },
    { label: "Settled short of order value", tone: "text-warn", dot: "bg-warn", count: 9, value: "AED 1,185.50" },
    { label: "Refund not deducted", tone: "text-info", dot: "bg-info", count: 3, value: "AED 312.00" },
  ];
  return (
    <div className="relative">
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-xl shadow-black/5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted">Marketplace seller · Sample report</p>
            <p className="mt-0.5 font-semibold tracking-tight">Orders vs. marketplace settlement</p>
          </div>
          <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">Reconciled</span>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2">
          {[
            { k: "Matched", v: "96.4%", c: "text-success" },
            { k: "Exceptions", v: "26", c: "text-danger" },
            { k: "Value at risk", v: "AED 7,917", c: "text-danger" },
          ].map((t) => (
            <div key={t.k} className="rounded-lg border border-border p-3">
              <p className="text-[11px] text-muted">{t.k}</p>
              <p className={`tabular mt-1 text-lg font-semibold tracking-tight ${t.c}`}>{t.v}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center gap-3 border-b border-border px-3 py-2.5 text-sm last:border-b-0">
              <span aria-hidden className={`size-2 rounded-full ${r.dot}`} />
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              <span className="tabular text-muted">{r.count}</span>
              <span className={`tabular w-28 text-right font-medium ${r.tone}`}>{r.value}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between text-xs text-muted">
          <span>2 files · 4,812 rows · matched in 3s</span>
          <span className="rounded-md border border-border px-2 py-1 font-medium text-foreground">Excel</span>
        </div>
      </div>
    </div>
  );
}

async function Pricing() {
  await connection();
  const { paywallEnabled, trialDays } = await getSettings();
  if (!paywallEnabled) {
    return (
      <div className="mx-auto mt-12 max-w-xl rounded-2xl border border-border bg-surface p-8 text-center">
        <p className="text-sm font-medium text-success">Early access</p>
        <p className="mt-2 text-2xl font-semibold tracking-tight">Free while we&apos;re in early access</p>
        <p className="mt-2 text-sm text-muted">Every template, every export, your whole team. We&apos;ll give plenty of notice before any paid plans start.</p>
        <Link href="/signup" className={`${buttonClass("primary")} mt-6`}>
          Start free
        </Link>
      </div>
    );
  }
  return (
    <div className="mt-12 grid gap-4 md:grid-cols-3">
      {PLANS.filter((p) => p.public).map((p) => (
        <div key={p.id} className={`flex flex-col rounded-2xl border bg-surface p-6 ${p.id === "growth" ? "border-foreground ring-1 ring-foreground" : "border-border"}`}>
          <p className="font-semibold">{p.name}</p>
          <p className="mt-1 text-sm text-muted">{p.blurb}</p>
          <p className="mt-5 text-2xl font-semibold tracking-tight">{p.price}</p>
          <ul className="mt-5 flex-1 space-y-2 text-sm">
            {p.features.map((f) => (
              <li key={f} className="flex gap-2">
                <span className="text-success" aria-hidden>
                  ✓
                </span>
                {f}
              </li>
            ))}
          </ul>
          <Link href="/signup" className={`${buttonClass(p.id === "growth" ? "primary" : "secondary")} mt-6`}>
            {p.id === "enterprise" ? "Start a trial, then talk to us" : `Start ${trialDays}-day free trial`}
          </Link>
        </div>
      ))}
    </div>
  );
}
