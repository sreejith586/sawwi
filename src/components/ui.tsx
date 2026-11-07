// Shared button styles (neutral: near-black in light mode, near-white in dark).
export function buttonClass(variant: "primary" | "secondary" = "primary") {
  const base =
    "inline-flex h-9 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:pointer-events-none disabled:opacity-40";
  return variant === "primary"
    ? `${base} bg-accent text-accent-foreground shadow-sm hover:bg-accent-strong`
    : `${base} border border-border bg-surface text-foreground shadow-sm hover:bg-surface-muted`;
}
