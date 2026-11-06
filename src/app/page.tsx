import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getProfile } from "@/lib/profile/session";

async function Entry() {
  const profile = await getProfile();
  redirect(profile ? "/templates" : "/onboarding");
  return null;
}

export default function Home() {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <Entry />
    </Suspense>
  );
}
