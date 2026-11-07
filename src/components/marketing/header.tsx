import Link from "next/link";
import { Suspense } from "react";
import { buttonClass } from "@/components/ui";
import { getCurrentSession } from "@/lib/saas/session";
import { LogoLockup } from "@/components/brand/logo";

const SECTIONS = [
  { href: "/#features", label: "Features" },
  { href: "/#how", label: "How it works" },
  { href: "/#templates", label: "Templates" },
  { href: "/#pricing", label: "Pricing" },
];

export function Logo() {
  return (
    <Link href="/" className="flex items-center">
      <LogoLockup />
    </Link>
  );
}

const SignedOut = () => (
  <>
    <Link href="/login" className="hidden h-9 items-center rounded-lg px-3 text-sm font-medium text-muted hover:text-foreground sm:inline-flex">
      Log in
    </Link>
    <Link href="/signup" className={buttonClass("primary")}>
      Start free
    </Link>
  </>
);

async function AuthActions() {
  const session = await getCurrentSession();
  if (!session) return <SignedOut />;
  return (
    <Link href="/home" className={buttonClass("primary")}>
      Open Sawwi
    </Link>
  );
}

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Logo />
        <nav aria-label="Sections" className="hidden items-center gap-1 md:flex">
          {SECTIONS.map((s) => (
            <a key={s.href} href={s.href} className="rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:text-foreground">
              {s.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Suspense fallback={<SignedOut />}>
            <AuthActions />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
