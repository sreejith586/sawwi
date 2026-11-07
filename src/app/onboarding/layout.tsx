import { ThemeToggle } from "@/components/theme-toggle";
import { LogoLockup } from "@/components/brand/logo";

// First-run setup stays focused: no sidebar, just the logo and the theme switch.
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center gap-2 border-b border-border px-4 sm:px-6">
        <span className="flex items-center">
          <LogoLockup />
        </span>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
