import "server-only";
import type { InboundEmailContentToStore } from "@/db/inbound-email-processing";
import { encryptText } from "@/lib/encryption";
import {
  inboundEmailAttachmentsContext,
  inboundEmailBodyContext,
  inboundEmailSubjectContext,
} from "@/lib/encryption-contexts";
import { htmlToPlainText } from "@/lib/html-to-text";
import type { InboundEmailContent } from "@/lib/inbound-email";
import { toPlainSingleLine } from "@/lib/plain-text";
import type { EmailSender } from "./inbound-email-sender";

// How much of a received email is kept (step 27). Claude only sees the first
// 6,000 characters (lib/email-triage/prompt.ts); this is what the ticket
// keeps and shows, so a pasted log file can't fill the database or the page.
const MAX_SUBJECT_CHARACTERS = 1_000;
const MAX_BODY_CHARACTERS = 100_000;
const CUT_NOTE = "\n\n[The rest of this email was cut: it was longer than 100,000 characters.]";

// File names kept per email, and how long each may be.
const MAX_ATTACHMENT_NAMES = 20;
const MAX_ATTACHMENT_NAME_CHARACTERS = 200;

// How the HTML part shows a file inside the email: <img src="cid:<content id>">.
const CONTENT_ID_REFERENCE = /cid:([^"'\s<>()]+)/gi;

type Attachment = NonNullable<InboundEmailContent["attachments"]>[number];

// The parts of a received email the ticket keeps.
export type PreparedEmail = {
  subject: string;
  // The plain-text part, or text made from the HTML part when there is none.
  body: string | null;
  // There was no plain-text part, only an HTML one: the body is its text,
  // or null when it held none (the ticket says so).
  bodyFromHtml: boolean;
  // Files the customer attached (not the images shown inside the email).
  attachmentCount: number;
  attachmentNames: string[];
  // Images the HTML shows inside the email: logos, signatures, pasted pictures.
  inlineImageCount: number;
};

// Picks and caps what is kept of a received email. An email without a
// plain-text part keeps the text of its HTML part instead, so the expert
// (and Claude) can read what the customer wrote. Attachments themselves are
// not kept, only how many there were and their names.
export function prepareEmail(content: InboundEmailContent): PreparedEmail {
  const plainText = content.text?.trim() ? content.text : null;
  const hasHtml = Boolean(content.html?.trim());
  const htmlText = !plainText && content.html ? htmlToPlainText(content.html, MAX_BODY_CHARACTERS) : null;
  const attachments = content.attachments ?? [];
  const shownInHtml = findContentIdsShownInHtml(content.html ?? "");
  const files = attachments.filter((attachment) => !isShownInHtml(attachment, shownInHtml));
  return {
    subject: content.subject.slice(0, MAX_SUBJECT_CHARACTERS),
    body: capBody(plainText ?? (htmlText || null)),
    bodyFromHtml: !plainText && hasHtml,
    attachmentCount: files.length,
    attachmentNames: files
      .map((attachment) => toPlainSingleLine(attachment.filename ?? "").slice(0, MAX_ATTACHMENT_NAME_CHARACTERS))
      .filter(Boolean)
      .slice(0, MAX_ATTACHMENT_NAMES),
    inlineImageCount: attachments.length - files.length,
  };
}

// The content ids the HTML part refers to, lowercase. WHY not Resend's
// content_disposition: Apple Mail marks real attachments (a PDF, a photo)
// "inline" too, so only a reference from the HTML tells a logo or a pasted
// picture from a file the customer attached.
function findContentIdsShownInHtml(html: string): Set<string> {
  const ids = new Set<string>();
  for (const match of html.matchAll(CONTENT_ID_REFERENCE)) {
    ids.add(match[1].toLowerCase());
  }
  return ids;
}

// A content id is written "<image001.png@01D9>" in the email and
// "cid:image001.png@01D9" in its HTML.
function isShownInHtml(attachment: Attachment, shownInHtml: Set<string>): boolean {
  const contentId = (attachment.content_id ?? "").trim().replace(/^<(.*)>$/, "$1").toLowerCase();
  return contentId !== "" && shownInHtml.has(contentId);
}

// The email as it is stored on its inbound_emails row: subject, body and file
// names encrypted with this company's and email's context.
export function encryptForStorage(
  companyId: string,
  inboundEmailId: string,
  email: PreparedEmail,
  sender: EmailSender,
): InboundEmailContentToStore {
  const attachmentNames = email.attachmentNames.length > 0 ? JSON.stringify(email.attachmentNames) : null;
  return {
    fromAddress: sender.shownAddress,
    senderVerified: sender.verified,
    replyToAddress: sender.replyToAddress,
    subjectEncrypted: encryptText(email.subject, inboundEmailSubjectContext(companyId, inboundEmailId)),
    bodyEncrypted: email.body ? encryptText(email.body, inboundEmailBodyContext(companyId, inboundEmailId)) : null,
    bodyFromHtml: email.bodyFromHtml,
    attachmentCount: email.attachmentCount,
    attachmentNamesEncrypted: attachmentNames ? encryptText(attachmentNames, inboundEmailAttachmentsContext(companyId, inboundEmailId)) : null,
    inlineImageCount: email.inlineImageCount,
  };
}

// Cuts a body longer than MAX_BODY_CHARACTERS, saying so at the end.
function capBody(body: string | null): string | null {
  if (!body || body.length <= MAX_BODY_CHARACTERS) {
    return body;
  }
  return body.slice(0, MAX_BODY_CHARACTERS) + CUT_NOTE;
}
