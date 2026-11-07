import Link from "next/link";
import { LogoLockup } from "@/components/brand/logo";
import { SOLUTIONS } from "@/lib/seo/solutions";

// The public footer: links to every reconciliation page and the template catalogue, so each
// public page is one click from the others (D-47).
export function MarketingFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 text-sm sm:px-6 md:grid-cols-[1fr_2fr_1fr]">
        <div>
          <Link href="/" className="flex items-center">
            <LogoLockup size="sm" />
          </Link>
          <p className="mt-3 max-w-xs text-muted">Reconciliation for e-commerce sellers in the UAE, Saudi Arabia and the GCC.</p>
        </div>
        <nav aria-label="Reconciliations">
          <p className="font-medium">Reconciliations</p>
          <ul className="mt-3 grid gap-2 text-muted sm:grid-cols-2">
            {SOLUTIONS.map((s) => (
              <li key={s.slug}>
                <Link href={`/reconciliation/${s.slug}`} className="hover:text-foreground">
                  {s.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Sawwi">
          <p className="font-medium">Sawwi</p>
          <ul className="mt-3 space-y-2 text-muted">
            <li>
              <Link href="/reconciliation-templates" className="hover:text-foreground">
                Template catalogue
              </Link>
            </li>
            <li>
              <Link href="/#pricing" className="hover:text-foreground">
                Pricing
              </Link>
            </li>
            <li>
              <Link href="/signup" className="hover:text-foreground">
                Create an account
              </Link>
            </li>
            <li>
              <Link href="/login" className="hover:text-foreground">
                Log in
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
