import type { Metadata } from "next";
import { Suspense } from "react";
import { LogInForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Log in" };

export default function LogInPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1.5 text-sm text-muted">Log in to your Sawwi workspace.</p>
      <div className="mt-8">
        {/* useSearchParams (for ?next=) is request data, so the form streams in. */}
        <Suspense fallback={<div className="h-64" />}>
          <LogInForm />
        </Suspense>
      </div>
    </>
  );
}
