import { jsonLdString } from "@/lib/seo/jsonld";

/** Structured data for search engines, rendered as recommended in Next's JSON-LD guide. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}
