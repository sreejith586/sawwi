import { NextResponse, type NextRequest } from "next/server";
import { decodeProfileCookie, PROFILE_COOKIE } from "@/lib/profile/profile";

// Route guards run here, before rendering, so pages never redirect mid-render
// (which would block instant navigation). This is an optimistic check only;
// server actions and route handlers still verify the profile themselves.
export function proxy(request: NextRequest) {
  const hasProfile = Boolean(decodeProfileCookie(request.cookies.get(PROFILE_COOKIE)?.value));
  const { pathname } = request.nextUrl;

  if (pathname === "/") {
    return NextResponse.redirect(new URL(hasProfile ? "/home" : "/onboarding", request.url));
  }
  if (!hasProfile) {
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/home", "/templates", "/runs/:path*", "/settings/:path*"],
};
