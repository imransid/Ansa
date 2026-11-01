import "server-only";
import { createHmac } from "node:crypto";
import { cookies, headers } from "next/headers";
import { env } from "@/lib/env";
import { getClientIpFromHeaders } from "@/lib/request-ip";
import { KNOWN_DEVICE_COOKIE_NAME } from "@/lib/known-device";

// The screens' one door to the new backend, the Go core's API
// (docs/backend/modules/api.md). Every request is signed with
// SCREENS_SHARED_SECRET (hex HMAC-SHA256 of "<unix seconds>.<METHOD>
// <path?query>.<body>"), and carries the browser's Better Auth session cookie
// as it came: core reads the session itself; the company always comes from
// it, never from what we send. Off (CORE_API_URL unset): every screen keeps
// using services/ as before.

// Better Auth's session cookie names ("__Secure-" first on https).
const SESSION_COOKIES = ["__Secure-better-auth.session_token", "better-auth.session_token"];

export function isCoreOn(): boolean {
  return Boolean(env.CORE_API_URL && env.SCREENS_SHARED_SECRET);
}

export type CoreAnswer<T> =
  | { ok: true; data: T }
  // fields: a problem per form field, in core's words.
  | { ok: false; status: number; message: string; fields: Record<string, string> };

// A cookie core asks the screens to set (a login, a logout).
export type CoreCookie = { name: string; value: string; maxAge: number; httpOnly: boolean; secure: boolean; sameSite: "lax"; path: string };

// Calls core. GET with no body; POST with a JSON body.
export async function callCore<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<CoreAnswer<T>> {
  const text = body === undefined ? "" : JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", env.SCREENS_SHARED_SECRET ?? "")
    .update(`${timestamp}.${method} ${path}.${text}`)
    .digest("hex");
  const response = await fetch(`${env.CORE_API_URL}${path}`, {
    method,
    headers: {
      "X-Ansa-Timestamp": timestamp,
      "X-Ansa-Signature": signature,
      ...(text ? { "Content-Type": "application/json" } : {}),
      Cookie: await sessionCookieHeader(),
    },
    body: text || undefined,
    cache: "no-store",
  });
  const answer: unknown = await response.json().catch(() => null);
  if (response.ok) {
    return { ok: true, data: answer as T };
  }
  const problem = (answer ?? {}) as { error?: string; fields?: Record<string, string> };
  return {
    ok: false,
    status: response.status,
    message: problem.error ?? "Something went wrong. Try again in a moment.",
    fields: problem.fields ?? {},
  };
}

// What the login pages send core about the browser (in the signed body).
export async function describeBrowser(): Promise<{ clientIp: string; userAgent: string; knownDevice: string }> {
  const requestHeaders = await headers();
  const jar = await cookies();
  return {
    clientIp: getClientIpFromHeaders(requestHeaders),
    userAgent: (requestHeaders.get("user-agent") ?? "").slice(0, 500),
    knownDevice: jar.get(KNOWN_DEVICE_COOKIE_NAME)?.value ?? "",
  };
}

// Sets the cookies core answered (only inside a server action). Core sends
// a value already URL-encoded, as Better Auth writes it; Next encodes what
// it sets, so it gets the decoded value.
export async function setCoreCookies(list: CoreCookie[] | undefined): Promise<void> {
  const jar = await cookies();
  for (const cookie of list ?? []) {
    jar.set(cookie.name, decodeURIComponent(cookie.value), { maxAge: cookie.maxAge, httpOnly: cookie.httpOnly, secure: cookie.secure, sameSite: cookie.sameSite, path: cookie.path });
  }
}

// The session cookie as the browser sent it: Next hands us the value
// decoded, so it is encoded again (core checks the signature on its bytes).
async function sessionCookieHeader(): Promise<string> {
  const jar = await cookies();
  return SESSION_COOKIES.flatMap((name) => {
    const value = jar.get(name)?.value;
    return value ? [`${name}=${encodeURIComponent(value)}`] : [];
  }).join("; ");
}
