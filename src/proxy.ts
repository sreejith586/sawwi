import { NextResponse, type NextRequest } from "next/server";
import { ONBOARDED_COOKIE, SESSION_COOKIE } from "@/lib/saas/cookies";

// Optimistic route guards, run before rendering so pages never redirect mid-render.
// Only cookie presence is checked here; every page, server action and route handler
// re-validates the session against the database (src/lib/saas/session.ts).
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const signedIn = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const onboarded = Boolean(request.cookies.get(ONBOARDED_COOKIE)?.value);

  if (!signedIn) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }
  if (!onboarded && pathname !== "/onboarding" && !pathname.startsWith("/admin")) {
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }
  return NextResponse.next();
}

// Public: "/" (intro page), /login, /signup. Everything below needs an account.
export const config = {
  matcher: ["/home", "/onboarding", "/templates/:path*", "/runs/:path*", "/schedules/:path*", "/settings/:path*", "/admin/:path*", "/checkout/:path*"],
};
