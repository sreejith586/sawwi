"use client";

import { Analytics } from "@vercel/analytics/next";
import { vercelBeforeSend } from "@/lib/analytics/vercel";

// Vercel Web Analytics (D-98): cookieless page views, counted only on Vercel deployments with
// Web Analytics switched on for the project. A client component so the URL filter can be passed.
export function VercelAnalytics() {
  return <Analytics beforeSend={vercelBeforeSend} />;
}
