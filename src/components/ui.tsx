// Shared button styles: primary is the brand emerald (D-45), secondary stays neutral.
export function buttonClass(variant: "primary" | "secondary" = "primary") {
  const base =
    "inline-flex h-9 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:pointer-events-none disabled:opacity-40";
  return variant === "primary"
    ? `${base} bg-brand text-on-brand shadow-sm hover:bg-brand-strong`
    : `${base} border border-border bg-surface text-foreground shadow-sm hover:bg-surface-muted`;
}
