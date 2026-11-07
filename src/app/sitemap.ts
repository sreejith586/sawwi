import type { MetadataRoute } from "next";
import { SOLUTIONS } from "@/lib/seo/solutions";
import { appUrl } from "@/lib/site";
import { TEMPLATES } from "@/lib/templates/catalog";

// D-47: every public page. The app behind login isn't listed.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = appUrl();
  return [
    { url: base, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/reconciliation`, changeFrequency: "weekly", priority: 0.9 },
    ...SOLUTIONS.map((s) => ({ url: `${base}/reconciliation/${s.slug}`, changeFrequency: "monthly" as const, priority: 0.8 })),
    { url: `${base}/reconciliation-templates`, changeFrequency: "weekly", priority: 0.7 },
    ...TEMPLATES.map((t) => ({ url: `${base}/reconciliation-templates/${t.id}`, changeFrequency: "monthly" as const, priority: 0.6 })),
    { url: `${base}/signup`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${base}/login`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
