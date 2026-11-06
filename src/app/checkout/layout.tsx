import Link from "next/link";
import { Logo } from "@/components/marketing/header";
import { ThemeToggle } from "@/components/theme-toggle";

// Checkout is a focused page: no sidebar, just the logo, a way back, and the theme switch.
export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Logo />
          <Link href="/settings/billing" className="ml-auto text-sm text-muted hover:text-foreground">
            ← Back to billing
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-5 text-xs text-muted sm:px-6">
          <svg aria-hidden viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="9" width="12" height="8" rx="1.5" />
            <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
          </svg>
          Payments are processed securely by Stripe. Sawwi never sees or stores your card details.
        </div>
      </footer>
    </div>
  );
}
