import { isIP } from "node:net";

// Says whether an IP address is on the public internet, for lib/safe-fetch.ts
// (step 34): a server that fetches a URL someone typed must never reach this
// machine, the hosting provider's network or its metadata service
// (169.254.169.254), whatever the URL's host name resolves to.

// Private, shared, loopback, link-local, documentation, benchmark, multicast
// and reserved IPv4 ranges: [first address, prefix length].
const NON_PUBLIC_IPV4_RANGES: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

// The same for IPv6. ::/96 covers :: (unspecified), ::1 (loopback) and the
// old IPv4-compatible form; fec0::/10 is the old site-local range.
const NON_PUBLIC_IPV6_RANGES: [string, number][] = [
  ["::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
];

// IPv6 ranges that carry an IPv4 address in their last 32 bits: IPv4-mapped
// (::ffff:10.0.0.1) and NAT64 (64:ff9b::10.0.0.1). Checked as that IPv4 address.
const IPV4_CARRYING_IPV6_RANGES: [string, number][] = [
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
];

// True only for an address we may connect to. Anything that isn't a valid
// IPv4 or IPv6 address is false.
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    return !NON_PUBLIC_IPV4_RANGES.some(([first, prefix]) => inIpv4Range(ipv4ToNumber(address), first, prefix));
  }
  if (version !== 6) {
    return false;
  }
  const groups = ipv6Groups(address);
  if (IPV4_CARRYING_IPV6_RANGES.some(([first, prefix]) => inIpv6Range(groups, first, prefix))) {
    const ipv4 = groups[6] * 65536 + groups[7];
    return !NON_PUBLIC_IPV4_RANGES.some(([first, prefix]) => inIpv4Range(ipv4, first, prefix));
  }
  return !NON_PUBLIC_IPV6_RANGES.some(([first, prefix]) => inIpv6Range(groups, first, prefix));
}

function inIpv4Range(address: number, first: string, prefix: number): boolean {
  const shift = 32 - prefix;
  return Math.floor(address / 2 ** shift) === Math.floor(ipv4ToNumber(first) / 2 ** shift);
}

// Compares the first `prefix` bits, 16 at a time (one group of the address).
function inIpv6Range(groups: number[], first: string, prefix: number): boolean {
  const firstGroups = ipv6Groups(first);
  for (let index = 0; index < 8; index++) {
    const bitsInGroup = Math.min(16, prefix - index * 16);
    if (bitsInGroup <= 0) {
      return true;
    }
    const shift = 16 - bitsInGroup;
    if (groups[index] >> shift !== firstGroups[index] >> shift) {
      return false;
    }
  }
  return true;
}

// "10.0.0.1" -> 167772161. Only called on valid addresses (isIP checked).
function ipv4ToNumber(address: string): number {
  return address.split(".").reduce((value, part) => value * 256 + Number(part), 0);
}

// The eight 16-bit groups of a valid IPv6 address: "::" filled in, a dotted
// IPv4 tail ("::ffff:10.0.0.1") read as its two groups, a zone ("%en0") dropped.
function ipv6Groups(address: string): number[] {
  let text = address.split("%")[0].toLowerCase();
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const ipv4 = ipv4ToNumber(tail);
    text = `${text.slice(0, lastColon + 1)}${Math.floor(ipv4 / 65536).toString(16)}:${(ipv4 % 65536).toString(16)}`;
  }
  const [head, rest] = text.split("::");
  const headGroups = head ? head.split(":") : [];
  const restGroups = rest === undefined ? [] : rest ? rest.split(":") : [];
  const zeros = rest === undefined ? [] : Array<string>(8 - headGroups.length - restGroups.length).fill("0");
  return [...headGroups, ...zeros, ...restGroups].map((group) => Number.parseInt(group, 16));
}
