import { appUrl } from "@/lib/site";
import type { Faq } from "./solutions";

// Structured data for search engines (D-47): what Sawwi is, page breadcrumbs, and FAQs where a
// page has them. Facts only: no ratings, reviews or offers we don't make.

const abs = (path: string) => `${appUrl()}${path === "/" ? "" : path}`;

export function softwareApplication(description: string) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Sawwi",
    url: abs("/"),
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Reconciliation software",
    operatingSystem: "Web browser",
    description,
    areaServed: ["AE", "SA", "KW", "QA", "BH", "OM"],
  };
}

export function faqPage(faqs: Faq[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}

export function breadcrumbs(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: abs(it.path) })),
  };
}

/** Safe inside a <script> tag: no "</script>" or HTML comment can close it early. */
export const jsonLdString = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");
