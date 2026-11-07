import { startDemo } from "@/app/actions/demo";
import { buttonClass } from "@/components/ui";

/** A form button, so starting the demo is a POST (never triggered by a link prefetch). */
export function TryDemoButton({ className = "", label = "Try the live demo" }: { className?: string; label?: string }) {
  return (
    <form action={startDemo}>
      <button type="submit" className={`${buttonClass("secondary")} ${className}`}>
        {label}
      </button>
    </form>
  );
}
