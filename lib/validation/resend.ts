import { z } from "zod";

// Only used AFTER the Resend webhook signature has been verified. Just enough
// to know the event type and, for a received email, its id and recipients.
export const resendEventSchema = z.object({
  type: z.string().max(100),
  data: z
    .object({
      email_id: z.string().max(200).optional(),
      to: z.array(z.string().max(320)).max(50).optional(),
    })
    .optional(),
});

// "Ana Smith <ana@example.com>" or "ana@example.com" -> name and address.
export function parseMailbox(mailbox: string): { name: string | null; address: string } {
  const match = mailbox.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) {
    return { name: match[1].trim() || null, address: match[2].trim().toLowerCase() };
  }
  return { name: null, address: mailbox.trim().toLowerCase() };
}
