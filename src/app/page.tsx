import Link from "next/link";

// src/proxy.ts redirects "/" to onboarding or the template gallery; this only renders if it can't.
export default function Home() {
  return (
    <p className="text-muted">
      <Link href="/templates" className="font-medium underline decoration-border underline-offset-4 hover:decoration-foreground">
        Open your reconciliations
      </Link>
    </p>
  );
}
