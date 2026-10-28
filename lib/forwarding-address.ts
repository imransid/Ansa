import "server-only";
import { env } from "@/lib/env";

// Every company has ONE forwarding address, made by ansa (step 24):
//
//   c-<token>@<INBOUND_EMAIL_DOMAIN>
//
// <token> is companies.inbound_token: 32 random hex characters the database
// makes when the company is created (and again if ansa replaces it, with
// pnpm replace:forwarding-address). The company forwards its support mailbox
// (support@theircompany.com) there. Only this address decides which company a
// received email belongs to (services/inbound-email-routing.ts). An address
// someone types (support@acme.com) never does, because anyone can type any
// address, and anyone can write any address into an email's headers.
//
// The domain is part of every address, and only the current
// INBOUND_EMAIL_DOMAIN is read: changing it later cuts off every company's
// forwarding and every Reply-To already sent.

// Used when INBOUND_EMAIL_DOMAIN is not set, in development. Mail can never be
// delivered to a ".test" domain, so a forgotten setting sends nothing anywhere.
export const DEV_INBOUND_EMAIL_DOMAIN = "inbound.ansa.test";

// "c-" and the 32 hex characters of a token, nothing before or after.
const FORWARDING_LOCAL_PART = /^c-([0-9a-f]{32})$/;

// The domain forwarding addresses are on.
export function getInboundEmailDomain(): string {
  return env.INBOUND_EMAIL_DOMAIN ?? DEV_INBOUND_EMAIL_DOMAIN;
}

// One company's forwarding address, from its token.
export function buildForwardingAddress(inboundToken: string): string {
  return `c-${inboundToken}@${getInboundEmailDomain()}`;
}

// The token in a forwarding address, or null for any other address: another
// domain, or anything but "c-" + 32 hex characters before the "@".
export function readForwardingToken(address: string): string | null {
  const [localPart, domain, ...rest] = address.trim().toLowerCase().split("@");
  if (rest.length > 0 || domain !== getInboundEmailDomain()) {
    return null;
  }
  return localPart.match(FORWARDING_LOCAL_PART)?.[1] ?? null;
}

// True for every address on our receiving domain. They are all ansa's: a
// company can't list one as its own support address, and mail from one is ours.
export function isOnInboundEmailDomain(address: string): boolean {
  return address.trim().toLowerCase().endsWith(`@${getInboundEmailDomain()}`);
}
