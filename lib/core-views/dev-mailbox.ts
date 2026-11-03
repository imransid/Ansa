import "server-only";
import { callCore, describeBrowser } from "@/lib/core-api";

// The development mailbox (for trying and showing ansa on the laptop): the
// emails ansa "sent" here, which the stand-in outbox only writes to
// .dev-emails/ (core/internal/devmail). Core refuses it when real email is
// on or in production.

export type DevMail = { id: string; at: string; from: string; to: string; subject: string; text: string };

// The newest emails to the company's people and customers (owners).
export async function getDevMailboxFromCore(): Promise<{ available: boolean; emails: DevMail[] }> {
  const answer = await callCore<{ available: boolean; emails: DevMail[] }>("GET", "/api/v1/dev/mailbox");
  return answer.ok ? answer.data : { available: false, emails: [] };
}

// The newest email to an address, before a login (after signing up, or
// asking for a reset). null: none, or no development mailbox here.
export async function newestDevMailFromCore(email: string): Promise<DevMail | null> {
  const answer = await callCore<{ email: DevMail | null }>("POST", "/api/v1/dev/mailbox/newest", { email, ...(await describeBrowser()) });
  return answer.ok ? answer.data.email : null;
}
