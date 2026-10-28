// Where people go when they open an app page without being logged in, and
// where they go back to after logging in (step 32). Used by proxy.ts, by
// lib/session.ts and by the login action, so all three agree.

// The app's sections that need a login. proxy.ts matches the same list
// (its matcher must be written out by hand), and a check keeps the two equal
// and makes sure every page that reads the session is in one of them.
export const SIGNED_IN_SECTIONS = [
  "/dashboard",
  "/tickets",
  "/calls",
  "/emails",
  "/knowledge",
  "/cofounder",
  "/team",
  "/setup",
  "/billing",
  "/account",
];

// Where a login goes when it has nowhere better to go.
export const DEFAULT_AFTER_LOGIN = "/dashboard";

// The longest return path we keep: a real page's path and its list filters.
const LONGEST_RETURN_PATH = 2000;

// Only a path on this site: one "/" then not a second "/" or "\" (browsers
// read "//evil.test" and "/\evil.test" as another site), and after that only
// printable ASCII without "\" (\x21-\x5B and \x5D-\x7E): no space, backslash,
// control character or anything outside ASCII. Browsers drop tabs and line
// breaks from a URL, which could turn "/<tab>/evil.test" into "//evil.test".
// And Next writes the path unencoded into a response header, which Node
// refuses for characters like "日": the login would work, then fail. Real
// return paths are always ASCII: URLs percent-encode everything else.
const SAME_SITE_PATH = /^\/(?![/\\])[\x21-\x5B\x5D-\x7E]*$/;

// The login page for someone who wanted returnPath. The path goes in ?next=.
export function buildLoginUrl(returnPath: string): string {
  return `/login?next=${encodeURIComponent(returnPath)}`;
}

// The return path from a form or URL when it is safe to send someone there,
// else null. Never an address on another site: that would make our login
// page a way to send people to a phishing page after a real login.
export function readSafeReturnPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > LONGEST_RETURN_PATH) {
    return null;
  }
  return SAME_SITE_PATH.test(value) ? value : null;
}

// Where a login that worked goes: the page asked for, or the ticket list.
export function destinationAfterLogin(next: unknown): string {
  return readSafeReturnPath(next) ?? DEFAULT_AFTER_LOGIN;
}

// True for a path inside one of the sections that need a login.
export function isSignedInPath(pathname: string): boolean {
  return SIGNED_IN_SECTIONS.some((section) => pathname === section || pathname.startsWith(`${section}/`));
}

export type PageRequest = {
  method: string;
  pathname: string;
  // "?view=mine", or "" when there is none.
  search: string;
  // Only whether the browser sent a session cookie at all. Whether that
  // session is still valid is checked by the page itself (lib/session.ts).
  hasSessionCookie: boolean;
};

// Where proxy.ts sends a request before the page renders, or null to let it
// through. Only page views (GET and HEAD) are redirected: a form post is a
// server action, which checks the session itself and answers with its own
// redirect to /login.
export function loginRedirectFor(request: PageRequest): string | null {
  const isPageView = request.method === "GET" || request.method === "HEAD";
  if (!isPageView || request.hasSessionCookie || !isSignedInPath(request.pathname)) {
    return null;
  }
  return buildLoginUrl(`${request.pathname}${request.search}`);
}
