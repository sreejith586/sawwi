import { ThemeToggle } from "@/components/theme-toggle";

// First-run setup stays focused: no sidebar, just the logo and the theme switch.
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center gap-2 border-b border-border px-4 sm:px-6">
        <span className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <span className="grid size-7 place-items-center rounded-lg bg-accent text-[13px] font-bold text-accent-foreground">S</span>
          Sawwina
        </span>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
