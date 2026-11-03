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
// asking for a reset): null when there is none, or why core won't show it
// (a real address, too many looks, no development mailbox here).
export type NewestDevMail = { email: DevMail | null; problem: string | null };

export async function newestDevMailFromCore(email: string): Promise<NewestDevMail> {
  const answer = await callCore<{ email: DevMail | null }>("POST", "/api/v1/dev/mailbox/newest", { email, ...(await describeBrowser()) });
  if (!answer.ok) {
    return { email: null, problem: answer.fields.email ?? answer.message };
  }
  return { email: answer.data.email, problem: null };
}
