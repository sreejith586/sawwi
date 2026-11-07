import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false } };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-1.5 text-sm text-muted">Enter the email you log in with. We&apos;ll send a link to choose a new password.</p>
      <div className="mt-8">
        <ForgotPasswordForm />
      </div>
    </>
  );
}
