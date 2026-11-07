import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/site";

// D-47: public pages are crawlable; the app behind login, the API and the auth flows aren't.
// Preview deployments ask not to be crawled at all.
export default function robots(): MetadataRoute.Robots {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/home", "/onboarding", "/templates", "/runs", "/schedules", "/settings", "/admin", "/checkout", "/forgot-password", "/reset-password"],
    },
    sitemap: `${appUrl()}/sitemap.xml`,
    host: appUrl(),
  };
}
