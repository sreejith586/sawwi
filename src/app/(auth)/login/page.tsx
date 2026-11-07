import type { Metadata } from "next";
import { Suspense } from "react";
import { LogInForm } from "@/components/auth-form";
import { TryDemoButton } from "@/components/demo/try-demo";
import { demoEnabled } from "@/lib/demo/enabled";

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
      {demoEnabled() && (
        <div className="mt-8 rounded-xl border border-dashed border-border p-4 text-sm">
          <p className="font-medium">Just looking?</p>
          <p className="mt-1 text-muted">Open the live demo store: invented marketplace, webstore and ERP data you can reconcile in a few clicks. No account needed; it resets every day.</p>
          <div className="mt-3">
            <TryDemoButton />
          </div>
        </div>
      )}
    </>
  );
}
