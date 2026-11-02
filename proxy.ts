import { NextResponse, type NextRequest } from "next/server";
import { loginRedirectFor } from "@/lib/login-redirect";

// The login cookie's names (lib/core-api.ts SESSION_COOKIES, repeated here:
// this file runs before every page and must stay small).
const SESSION_COOKIES = ["__Secure-better-auth.session_token", "better-auth.session_token"];

// Runs before every app page (Next.js 16 calls this file "proxy"; it used to
// be "middleware"). A visitor with no session cookie at all is sent to /login
// with a real 307 redirect, remembering the page in ?next=, so they never see
// a "Loading..." page that only then moves them on. WHY only the cookie's
// presence: this runs on every page view and prefetch, so it never touches
// core. Every page still checks the session for real (lib/session.ts asks
// core), and so does every server action: this is a shortcut, not the lock.
export function proxy(request: NextRequest) {
  const destination = loginRedirectFor({
    method: request.method,
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    hasSessionCookie: SESSION_COOKIES.some((name) => Boolean(request.cookies.get(name)?.value)),
  });
  if (!destination) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL(destination, request.url));
}

// The sections in SIGNED_IN_SECTIONS (lib/login-redirect.ts), written out
// because Next.js reads this list when building. A check keeps them equal
// (scripts/screen-checks/login-redirect-checks.ts).
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/inbox/:path*",
    "/orders/:path*",
    "/tickets/:path*",
    "/calls/:path*",
    "/emails/:path*",
    "/knowledge/:path*",
    "/cofounder/:path*",
    "/team/:path*",
    "/setup/:path*",
    "/billing/:path*",
    "/account/:path*",
    "/settings/:path*",
    "/welcome/:path*",
  ],
};
