import type { Metadata } from "next";

// Metadata for a public page (D-47): title, description, canonical URL on APP_URL (sawwiapp.ai),
// OpenGraph and Twitter cards. A page's own openGraph replaces the root one, so the shared
// preview image (app/opengraph-image.tsx) is named here again.

const IMAGE = { url: "/opengraph-image", width: 1200, height: 630, alt: "Sawwi: reconciliation for GCC e-commerce sellers" };

export function pageMetadata({ title, description, path }: { title: string; description: string; path: string }): Metadata {
  const full = `${title} · Sawwi`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: "Sawwi", url: path, title: full, description, images: [IMAGE] },
    twitter: { card: "summary_large_image", title: full, description, images: [IMAGE] },
  };
}
