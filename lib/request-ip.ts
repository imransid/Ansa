import "server-only";
import { isIPv6 } from "node:net";

// Returns the caller's address from the request's headers, as the key for
// per-IP rate limits (that is its only use). Server actions pass
// `await headers()`; route handlers pass `request.headers`.
// An IPv6 address comes back as its /64 network, e.g. "2001:db8:1:2::/64".
export function getClientIpFromHeaders(headerList: Pick<Headers, "get">): string {
  return toRateLimitKey(readClientAddress(headerList));
}

function readClientAddress(headerList: Pick<Headers, "get">): string {
  // x-forwarded-for looks like "client, proxy1, proxy2". The first entry is
  // the original caller. This header is only trustworthy when the hosting
  // platform overwrites it (Vercel and Cloudflare do; see docs/going-live.md).
  const forwardedFor = headerList.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  return headerList.get("x-real-ip") ?? "unknown";
}

// WHY the /64: whoever has one IPv6 connection (even a cheap server) usually
// gets a whole /64 network, 2^64 addresses. Counting each address on its own
// would give them endless fresh counters. IPv4 addresses, and anything that is
// not an address, stay as they are.
function toRateLimitKey(address: string): string {
  // "fe80::1%eth0": the part after "%" only names a network card.
  const withoutZone = address.split("%")[0];
  if (!isIPv6(withoutZone)) {
    return address;
  }
  const network = firstFourGroups(withoutZone);
  // ::/64 holds loopback (::1) and IPv4 written as IPv6 (::ffff:203.0.113.5),
  // which are not one person's network: those stay whole.
  if (network.every((group) => group === "0")) {
    return withoutZone.toLowerCase();
  }
  return `${network.join(":")}::/64`;
}

// The first four groups of an IPv6 address, written out the same way every
// time: "2001:0DB8::1" -> ["2001", "db8", "0", "0"].
function firstFourGroups(address: string): string[] {
  // "::" stands for as many zero groups as are missing (at most one "::").
  const [head, tail] = address.split("::");
  const headGroups = head === "" ? [] : head.split(":");
  const tailGroups = tail === undefined || tail === "" ? [] : tail.split(":");
  const allGroups = [...headGroups, ...missingZeroGroups(address, headGroups, tailGroups), ...tailGroups];
  return allGroups.slice(0, 4).map((group) => parseInt(group, 16).toString(16));
}

function missingZeroGroups(address: string, headGroups: string[], tailGroups: string[]): string[] {
  if (!address.includes("::")) {
    return [];
  }
  // An IPv4 ending ("::ffff:1.2.3.4") fills two of the eight groups.
  const ipv4EndingGroups = address.includes(".") ? 1 : 0;
  const writtenGroups = headGroups.length + tailGroups.length + ipv4EndingGroups;
  return Array.from({ length: 8 - writtenGroups }, () => "0");
}
