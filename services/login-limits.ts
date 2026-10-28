import "server-only";
import { readKnownDeviceId } from "@/lib/known-device";
import { getClientIpFromHeaders } from "@/lib/request-ip";
import { isOverRateLimit, RATE_LIMITS, takeBackRateLimitAttempt } from "./rate-limit";

// Password attempts on /login and /verify-email share these counters, so
// guesses on both pages add up. They are built to be fair to real users:
// - A stranger guessing someone's password only uses up the counter for that
//   address from THEIR OWN IP. The real user, somewhere else, has their own.
// - A team behind one office IP shares a large per-IP limit.
// - An attempt whose password is right takes itself back (a login, or an
//   unconfirmed account's login or confirm), so only failures add up.
// - The per-address cap across all IPs stops guessing spread over many IPs.
//   Anyone with enough IPs can fill it, so a browser that logged in to the
//   account before (lib/known-device.ts) counts on its own counter instead:
//   strangers can't keep the person out of the browsers they already use.
// See RATE_LIMITS for the numbers.

// One login (or confirm) attempt, as the limits see it.
export type LoginAttempt = {
  email: string;
  ip: string;
  // Set when the browser holds a valid known-device cookie for this address.
  knownDeviceId: string | null;
};

// Which limit refused an attempt.
export type LoginLimit = "ip" | "address-and-ip" | "known-device" | "address";

// Reads the IP and the known-device cookie of the request for this address.
export function describeLoginAttempt(email: string, requestHeaders: Headers): LoginAttempt {
  return {
    email,
    ip: getClientIpFromHeaders(requestHeaders),
    knownDeviceId: readKnownDeviceId(requestHeaders, email),
  };
}

// Counts one password attempt. Returns the limit that refused it, or null when
// the password may be checked.
export async function findLoginLimitReached(attempt: LoginAttempt): Promise<LoginLimit | null> {
  // Each counter only counts when the ones before it allowed the attempt. So
  // a stranger's refused attempts from one IP never reach the address's cap
  // across all IPs, and one stranger alone can't use that cap up.
  if (await isOverRateLimit("login-ip", attempt.ip, RATE_LIMITS.loginPerIp)) {
    return "ip";
  }
  if (await isOverRateLimit("login-email-ip", emailAndIp(attempt), RATE_LIMITS.loginPerEmailAndIp)) {
    return "address-and-ip";
  }
  if (attempt.knownDeviceId) {
    const tooManyFromDevice = await isOverRateLimit("login-device", attempt.knownDeviceId, RATE_LIMITS.loginPerKnownDevice);
    return tooManyFromDevice ? "known-device" : null;
  }
  const tooManyForAddress = await isOverRateLimit("login-email", attempt.email, RATE_LIMITS.loginPerEmail);
  return tooManyForAddress ? "address" : null;
}

// Takes back the attempt of a login whose password was right, so the real
// user's own logins never use up the limits for them or for their office.
export async function forgetSuccessfulLogin(attempt: LoginAttempt): Promise<void> {
  await takeBackRateLimitAttempt("login-ip", attempt.ip);
  await takeBackRateLimitAttempt("login-email-ip", emailAndIp(attempt));
  // The same counter findLoginLimitReached used for this attempt.
  if (attempt.knownDeviceId) {
    await takeBackRateLimitAttempt("login-device", attempt.knownDeviceId);
  } else {
    await takeBackRateLimitAttempt("login-email", attempt.email);
  }
}

// How long until the limit that refused lets attempts through again (the
// windows in RATE_LIMITS), for the message.
export function waitAfterLimit(limit: LoginLimit): string {
  return limit === "address" ? "an hour" : "15 minutes";
}

// A space can't appear in a valid email address, so no two pairs look alike.
function emailAndIp(attempt: LoginAttempt): string {
  return `${attempt.email} ${attempt.ip}`;
}
