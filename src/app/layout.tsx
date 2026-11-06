import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { InlineScript } from "@/components/inline-script";
import { NavLink } from "@/components/nav-link";
import { ProfileBadge } from "@/components/profile-badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Sawwi", template: "%s · Sawwi" },
  description: "Reconciliation for e-commerce and marketplace sellers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The inline script sets data-theme before React hydrates, hence suppressHydrationWarning.
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <InlineScript html={THEME_SCRIPT} />
      </head>
      <body className="flex min-h-full flex-col font-sans">
        <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
              <span className="grid size-7 place-items-center rounded-lg bg-accent text-[13px] font-bold text-accent-foreground">S</span>
              Sawwi
            </Link>
            <span className="h-5 w-px bg-border" aria-hidden />
            <nav className="flex items-center gap-1">
              {/* usePathname() is request data, so the active state streams in behind a static link. */}
              <Suspense
                fallback={
                  <Link href="/templates" className="rounded-md px-2.5 py-1.5 text-sm text-muted">
                    Templates
                  </Link>
                }
              >
                <NavLink href="/templates">Templates</NavLink>
              </Suspense>
            </nav>
            <div className="ml-auto flex items-center gap-1">
              <ThemeToggle />
              <Suspense fallback={null}>
                <ProfileBadge />
              </Suspense>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
      </body>
    </html>
  );
}
