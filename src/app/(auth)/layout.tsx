import { Logo } from "@/components/marketing/header";
import { ThemeToggle } from "@/components/theme-toggle";

// Sign-up and log-in: form on the left, a short reminder of what Sawwi does on the right.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,0.9fr)]">
      <div className="flex flex-col px-4 sm:px-8">
        <header className="flex h-16 items-center justify-between">
          <Logo />
          <ThemeToggle />
        </header>
        <main className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </main>
      </div>
      <aside className="hidden border-l border-border bg-surface lg:flex lg:flex-col lg:justify-center lg:px-14">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Why teams use Sawwi</p>
        <ul className="mt-6 space-y-6">
          {[
            ["Every payout accounted for", "Match marketplace, gateway, COD and B2B payments against orders and invoices."],
            ["Minutes, not days", "Upload the exports you already have. Columns are mapped for you and remembered."],
            ["Exceptions you can act on", "Short payments, missing refunds and unpaid orders, ranked by value, ready for Excel."],
          ].map(([t, b]) => (
            <li key={t} className="flex gap-3">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-success-soft text-success">
                <svg aria-hidden viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m4.5 10.5 3.5 3.5 7.5-8" />
                </svg>
              </span>
              <div>
                <p className="font-medium">{t}</p>
                <p className="mt-1 text-sm text-muted">{b}</p>
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
