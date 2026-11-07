import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { buttonClass } from "@/components/ui";
import { ResetPasswordForm } from "@/components/auth-form";
import { resetLinkValid } from "@/lib/saas/reset";

// The token is in the URL: no referrer leaves this page, and it's never indexed (D-46).
export const metadata: Metadata = { title: "Choose a new password", robots: { index: false }, referrer: "no-referrer" };

async function Reset({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw : "";
  // Checked against the clock and the database: request time only.
  await connection();
  if (!(await resetLinkValid(token))) {
    return (
      <div className="space-y-4">
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          This link has expired or was already used. Links work once, for an hour.
        </p>
        <Link href="/forgot-password" className={`${buttonClass("primary")} h-10 w-full`}>
          Get a new link
        </Link>
      </div>
    );
  }
  return <ResetPasswordForm token={token} />;
}

export default function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-1.5 text-sm text-muted">You&apos;ll be signed out on every device, then you can log in with it.</p>
      <div className="mt-8">
        <Suspense fallback={<div className="h-40" />}>
          <Reset searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}
