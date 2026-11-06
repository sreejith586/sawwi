import Link from "next/link";

// src/proxy.ts redirects "/" to onboarding or home; this only renders if it can't.
export default function Root() {
  return (
    <p className="p-8 text-muted">
      <Link href="/home" className="font-medium underline decoration-border underline-offset-4 hover:decoration-foreground">
        Open Sawwi
      </Link>
    </p>
  );
}
