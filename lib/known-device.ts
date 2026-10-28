import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

// The "known device" cookie: proof that this browser logged in to an account
// before. The login limits let such a browser past the per-address cap that
// anyone can fill up with wrong passwords (services/login-limits.ts), so a
// stranger can't keep a person out of the browsers they already use.
// Value: "<device id>.<expiry, unix seconds>.<signature>". The signature covers
// the account's email address, so the cookie only counts for that one address,
// and the address itself is never in the cookie. One cookie per browser: the
// last person who logged in on it.

export const KNOWN_DEVICE_COOKIE_NAME = "ansa_known_device";

const KNOWN_DEVICE_SECONDS = 90 * 24 * 60 * 60;

// How a service hands a new known-device cookie to the browser. Server actions
// pass a function that sets it with Next.js's cookies(); checks record it.
export type RememberBrowser = (cookieValue: string) => Promise<void> | void;

// A new cookie value for this email address (already validated and lowercased).
export function createKnownDeviceCookieValue(email: string): string {
  const deviceId = randomBytes(16).toString("base64url");
  const expiresAt = Math.floor(Date.now() / 1000) + KNOWN_DEVICE_SECONDS;
  return `${deviceId}.${expiresAt}.${sign(email, deviceId, expiresAt)}`;
}

// The device id of the request's known-device cookie, or null when there is
// none, or it is expired, altered, or for another address.
export function readKnownDeviceId(requestHeaders: Headers, email: string): string | null {
  const parts = readCookie(requestHeaders, KNOWN_DEVICE_COOKIE_NAME)?.split(".");
  if (!parts || parts.length !== 3) {
    return null;
  }
  const [deviceId, expiresAtText, signature] = parts;
  const expiresAt = Number(expiresAtText);
  if (!Number.isInteger(expiresAt) || expiresAt * 1000 < Date.now()) {
    return null;
  }
  return isSameText(signature, sign(email, deviceId, expiresAt)) ? deviceId : null;
}

// httpOnly: page scripts can't read it. It is sent on every request to our
// own site only, like the login cookie.
export function knownDeviceCookieOptions() {
  return {
    httpOnly: true,
    secure: env.BETTER_AUTH_URL.startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: KNOWN_DEVICE_SECONDS,
  };
}

function sign(email: string, deviceId: string, expiresAt: number): string {
  return createHmac("sha256", signingKey()).update(`${email}\n${deviceId}\n${expiresAt}`).digest("base64url");
}

// A key of its own, made from BETTER_AUTH_SECRET, so nothing Better Auth signs
// can ever pass for one of these signatures.
function signingKey(): Buffer {
  return createHmac("sha256", env.BETTER_AUTH_SECRET).update("ansa known-device cookie").digest();
}

// Compares in constant time, so the answer's timing doesn't give away how
// much of a forged signature was right.
function isSameText(given: string, expected: string): boolean {
  const givenBytes = Buffer.from(given);
  const expectedBytes = Buffer.from(expected);
  return givenBytes.length === expectedBytes.length && timingSafeEqual(givenBytes, expectedBytes);
}

// Reads one cookie from a Cookie header ("a=1; b=2").
function readCookie(requestHeaders: Headers, name: string): string | null {
  for (const cookie of (requestHeaders.get("cookie") ?? "").split(";")) {
    const [cookieName, ...valueParts] = cookie.trim().split("=");
    if (cookieName === name) {
      return valueParts.join("=");
    }
  }
  return null;
}
