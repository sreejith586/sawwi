"use client";

// Inline <script> that runs once during HTML parsing (server render) and is inert on the
// client, so React doesn't warn about rendering script tags. Pattern from Next's
// "Preventing flash before hydration" guide.
export function InlineScript({ html }: { html: string }) {
  return <script type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: html }} />;
}
