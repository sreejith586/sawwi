import Link from "next/link";
import { TryDemoButton } from "@/components/demo/try-demo";
import { buttonClass } from "@/components/ui";
import { demoEnabled } from "@/lib/demo/enabled";

/** Visible breadcrumbs; the same trail goes into JSON-LD. */
export function Breadcrumbs({ items }: { items: { name: string; path: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((it, i) => (
          <li key={it.path} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden>/</span>}
            {i === items.length - 1 ? (
              <span aria-current="page" className="text-foreground">
                {it.name}
              </span>
            ) : (
              <Link href={it.path} className="hover:text-foreground">
                {it.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Ctas() {
  return (
    <div className="mt-8 flex flex-wrap gap-3">
      <Link href="/signup" className={`${buttonClass("primary")} h-11 px-5 text-[15px]`}>
        Start free
      </Link>
      {demoEnabled() && <TryDemoButton className="h-11 px-5 text-[15px]" />}
    </div>
  );
}

export function ClosingCta() {
  return (
    <section className="px-4 pb-20 sm:px-6">
      <div className="mx-auto max-w-6xl rounded-3xl bg-accent px-6 py-12 text-center text-accent-foreground sm:px-12">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Bring last month&apos;s exports and see what&apos;s missing.</h2>
        <p className="mx-auto mt-3 max-w-xl opacity-75">Setup takes two minutes.{demoEnabled() ? " Or try the demo store with invented data first, no sign-up." : ""}</p>
        <Link
          href="/signup"
          className="mt-8 inline-flex h-11 items-center rounded-lg bg-background px-5 text-[15px] font-medium text-foreground shadow-sm transition-opacity hover:opacity-90"
        >
          Create your workspace
        </Link>
      </div>
    </section>
  );
}
