import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Create your account" };

export default function SignUpPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1.5 text-sm text-muted">Free to start. No card needed.</p>
      <div className="mt-8">
        <SignUpForm />
      </div>
    </>
  );
}
