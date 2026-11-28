import { ctaAttrs, type CtaLocation } from "@/lib/analytics/events";
import { startDemo } from "@/app/actions/demo";
import { buttonClass } from "@/components/ui";

/** A form button, so starting the demo is a POST (never triggered by a link prefetch). */
export function TryDemoButton({ className = "", label = "Try the live demo", location = "hero" }: { className?: string; label?: string; location?: CtaLocation }) {
  return (
    <form action={startDemo}>
      <button type="submit" className={`${buttonClass("secondary")} ${className}`} {...ctaAttrs("try_demo", location)}>
        {label}
      </button>
    </form>
  );
}
