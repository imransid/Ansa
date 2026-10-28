import { z } from "zod";

// The longest an address can be, and how many of each list we look at.
const MAX_ADDRESS_LENGTH = 320;
const MAX_RECIPIENTS = 50;

// A recipient list from Resend, never refused: a signed event that got a 400
// would be retried by Resend for days, and nothing would ever change. So a
// single address becomes a list, entries that aren't text or are too long to
// be an address are dropped, and at most 50 are kept (the 256 KB body cap
// already bounds the size).
function toRecipientList(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return entries
    .filter((entry): entry is string => typeof entry === "string" && entry.length <= MAX_ADDRESS_LENGTH)
    .slice(0, MAX_RECIPIENTS);
}

const recipientListSchema = z.unknown().optional().transform(toRecipientList);

// Only used AFTER the Resend webhook signature has been verified. Just enough
// to know the event type and, for a received email, its id and every field
// that can hold the company's forwarding address (see
// services/inbound-email-routing.ts).
export const resendEventSchema = z.object({
  type: z.string().max(100),
  data: z
    .object({
      email_id: z.string().max(200).optional(),
      to: recipientListSchema,
      cc: recipientListSchema,
      bcc: recipientListSchema,
      received_for: recipientListSchema,
    })
    .optional(),
});

export type ReceivedEmailRecipients = Pick<NonNullable<z.infer<typeof resendEventSchema>["data"]>, "to" | "cc" | "bcc" | "received_for">;

// One check result as Resend's receiving API reports it.
const authenticationResultSchema = z.enum(["pass", "fail", "gray", "processing_failed", "unknown"]).catch("unknown");

// The SPF, DKIM and DMARC results Resend's receiving API returns for a
// received email (`authentication`; resend@6.33.0's types leave it out).
// Resend's mail server works them out when the email arrives, not from the
// email's headers, so a sender can't fake them; Authentication-Results headers
// can be written by anyone and are never read. Never refused: a value we don't
// know counts as "unknown", and a missing or malformed object (older mail)
// becomes null. Either way the sender is then not verified.
export const receivedEmailAuthenticationSchema = z
  .object({ spf: authenticationResultSchema, dkim: authenticationResultSchema, dmarc: authenticationResultSchema })
  .nullable()
  .catch(null);

export type ReceivedEmailAuthentication = z.infer<typeof receivedEmailAuthenticationSchema>;

// One attachment as Resend's receiving API lists it: its file name (the
// ticket says how many there were and what they were called) and its content
// id, which the HTML uses ("cid:...") to show a logo or a pasted picture
// inside the email (services/inbound-email-content.ts counts those apart).
const attachmentSchema = z
  .object({ filename: z.string().nullable().catch(null), content_id: z.string().nullish().catch(null) })
  .catch({ filename: null });

// A received email's content, as Resend's Receiving API returns it and as the
// dev stand-in writes it (lib/inbound-email.ts reads both through this).
// Nothing is refused (step 27): a missing or odd From, a null subject or a
// field of an unexpected type becomes empty instead, so the email still
// becomes a ticket (without a customer email when there is no valid sender).
// Resend gives `from` as the bare address; the display name is only in
// headers.from (services/inbound-email-sender.ts reads both). `from` is kept
// whole: the sender check must see all of it before anything is cut.
export const receivedEmailContentSchema = z.object({
  from: z.string().catch(""),
  to: recipientListSchema,
  // Website contact forms and other relays put the customer here.
  reply_to: recipientListSchema.optional(),
  subject: z.string().catch(""),
  text: z.string().nullable().catch(null),
  // Its text is only used when there is no plain-text part; its "cid:"
  // references tell which attachments it shows inside the email
  // (services/inbound-email-content.ts).
  html: z.string().nullish().catch(null),
  attachments: z.array(attachmentSchema).optional().catch(undefined),
  headers: z.record(z.string(), z.unknown()).catch({}).transform(keepTextHeaders),
  authentication: receivedEmailAuthenticationSchema,
});

export type ReceivedEmailContent = z.infer<typeof receivedEmailContentSchema>;

function keepTextHeaders(headers: Record<string, unknown>): Record<string, string> {
  const textHeaders = Object.entries(headers).filter((header): header is [string, string] => typeof header[1] === "string");
  return Object.fromEntries(textHeaders);
}
