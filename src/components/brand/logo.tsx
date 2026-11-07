// The Sawwi logo (D-44): two sheets, the front one ticked. Two files, reconciled.
// Colours come from the --logo-* tokens in globals.css, so the mark follows the theme:
// a dark tile on light pages and a light tile on dark pages. The app icons in src/app
// (icon.svg, apple-icon.png, favicon.ico) are the same drawing on the dark tile.

export function LogoMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={`shrink-0 ${className}`} aria-hidden focusable="false">
      <rect width="64" height="64" rx="15" fill="var(--logo-tile)" />
      <rect x="11" y="13" width="26" height="32" rx="6" fill="var(--logo-sheet-back)" />
      <rect x="27" y="19" width="26" height="32" rx="6" fill="var(--logo-sheet)" />
      <path
        d="M33 35L38.5 40.5L48 30"
        fill="none"
        stroke="var(--logo-check)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Lowercase "sawwiapp", after the domain sawwiapp.ai, with "app" in the brand colour.
// Kept plain on purpose: no stylised "ww", which another company's wordmark uses (D-12).
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-semibold tracking-tight ${className}`}>
      sawwi<span className="text-brand">app</span>
    </span>
  );
}

export function LogoLockup({ size = "md" }: { size?: "sm" | "md" }) {
  const sm = size === "sm";
  return (
    <span className={`flex min-w-0 items-center ${sm ? "gap-1.5" : "gap-2"}`}>
      <LogoMark className={sm ? "size-6" : "size-7"} />
      <Wordmark className={sm ? "text-sm" : "text-[16px]"} />
    </span>
  );
}
