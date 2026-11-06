import Link from "next/link";

// src/proxy.ts redirects "/" to onboarding or the template gallery; this only renders if it can't.
export default function Home() {
  return (
    <p className="text-muted">
      <Link href="/templates" className="font-medium text-accent hover:text-accent-strong">
        Open your reconciliations
      </Link>
    </p>
  );
}
