import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { COUNTRIES, labelOf, MARKETPLACES, WEBSTORE_PLATFORMS } from "@/lib/profile/options";
import { getProfile } from "@/lib/profile/session";
import { TEMPLATES } from "@/lib/templates/catalog";
import { recommendTemplates } from "@/lib/templates/recommend";
import { TemplateGallery } from "./template-gallery";

export const metadata: Metadata = { title: "Templates" };

async function Gallery() {
  const profile = await getProfile();
  // src/proxy.ts sends visitors without a profile to onboarding; this is the fallback.
  if (!profile) {
    return (
      <p className="mt-4 text-muted">
        <Link href="/onboarding" className="font-medium underline decoration-border underline-offset-4 hover:decoration-foreground">
          Set up your profile
        </Link>{" "}
        to see your reconciliations.
      </p>
    );
  }

  const { recommended, others } = recommendTemplates(TEMPLATES, profile);
  const sellsOn = [
    ...profile.marketplaces.map((m) => labelOf(MARKETPLACES, m)),
    ...profile.platforms.map((p) => labelOf(WEBSTORE_PLATFORMS, p)),
    ...(profile.channels.includes("b2b") ? ["direct B2B"] : []),
  ];

  return (
    <>
      <p className="mt-1 text-muted">
        Pick a reconciliation to start. {recommended.length} fit {profile.company}: selling via {sellsOn.join(", ")} in{" "}
        {profile.countries.map((c) => labelOf(COUNTRIES, c)).join(", ")}.{" "}
        <Link href="/onboarding" className="font-medium underline decoration-border underline-offset-4 hover:decoration-foreground">
          Edit profile
        </Link>
      </p>

      <TemplateGallery recommended={recommended} others={others} />

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
      <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
      <Suspense fallback={<p className="mt-4 text-muted">Loading your templates…</p>}>
        <Gallery />
      </Suspense>
    </div>
  );
}
