import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { TemplateCard } from "@/components/template-card";
import { COUNTRIES, labelOf, MARKETPLACES, WEBSTORE_PLATFORMS } from "@/lib/profile/options";
import { getProfile } from "@/lib/profile/session";
import { TEMPLATES } from "@/lib/templates/catalog";
import { recommendTemplates } from "@/lib/templates/recommend";

export const metadata: Metadata = { title: "Reconciliation templates" };

async function Gallery() {
  const profile = await getProfile();
  if (!profile) redirect("/onboarding");

  const { recommended, others } = recommendTemplates(TEMPLATES, profile);
  const sellsOn = [
    ...profile.marketplaces.map((m) => labelOf(MARKETPLACES, m)),
    ...profile.platforms.map((p) => labelOf(WEBSTORE_PLATFORMS, p)),
    ...(profile.channels.includes("b2b") ? ["direct B2B"] : []),
  ];

  return (
    <>
      <p className="mt-1 text-muted">
        {recommended.length} reconciliations for {profile.company}: selling via {sellsOn.join(", ")} in{" "}
        {profile.countries.map((c) => labelOf(COUNTRIES, c)).join(", ")}.{" "}
        <Link href="/onboarding" className="font-medium text-accent hover:text-accent-strong">
          Edit profile
        </Link>
      </p>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Recommended for you</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {recommended.map((t) => (
            <TemplateCard key={t.id} template={t} />
          ))}
        </div>
      </section>

      {others.length > 0 && (
        <details className="group mt-10">
          <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-muted hover:text-foreground">
            Other templates ({others.length})
          </summary>
          <p className="mt-2 text-sm text-muted">
            These don&apos;t match your profile, but you can still run them.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {others.map((t) => (
              <TemplateCard key={t.id} template={t} dimmed />
            ))}
          </div>
        </details>
      )}

      <div className="mt-10 rounded-xl border border-dashed border-border p-5 text-sm">
        <p className="font-medium">Don&apos;t see your reconciliation?</p>
        <p className="mt-1 text-muted">
          Coming soon: answer a few questions, upload any two files, and save the setup as your own template.
        </p>
      </div>
    </>
  );
}

export default function TemplatesPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Your reconciliations</h1>
      <Suspense fallback={<p className="mt-4 text-muted">Loading your templates…</p>}>
        <Gallery />
      </Suspense>
    </div>
  );
}
