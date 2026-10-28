import "server-only";
import { readFromDevInbox } from "@/adapters/dev-email-inbox";
import { fetchReceivedEmailFromResend } from "@/adapters/resend";
import { isRealEmailOn } from "@/lib/send-email";
import { receivedEmailContentSchema, type ReceivedEmailContent } from "@/lib/validation/resend";

// Fetches the content of one received email: the webhook only says "an email
// arrived". Core code only calls this, never an adapter. Like sending
// (lib/send-email.ts), it uses Resend's Receiving API only when
// SEND_REAL_EMAIL is exactly "true", and the stand-in .dev-inbound/<id>.json
// (pnpm simulate:inbound-email) otherwise. Both go through one schema.

export type InboundEmailContent = ReceivedEmailContent;

// Resend ids are uuid-like; anything else never reaches the file system or the API.
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

// The checked content of one received email, or null when it can't be fetched
// (Resend is tried 3 times first). An email without a sender is still read.
export async function fetchInboundEmail(resendEmailId: string): Promise<InboundEmailContent | null> {
  if (!SAFE_ID.test(resendEmailId)) {
    return null;
  }
  const raw = isRealEmailOn() ? await fetchReceivedEmailFromResend(resendEmailId) : await readFromDevInbox(resendEmailId);
  const content = receivedEmailContentSchema.safeParse(raw);
  return content.success ? content.data : null;
}
