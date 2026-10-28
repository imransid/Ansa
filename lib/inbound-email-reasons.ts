// Why a received email did not become a ticket: the fixed codes stored in
// inbound_emails.ignored_reason (services/inbound-email-filters.ts and
// services/inbound-email-processing.ts write them), what the Emails and Setup
// pages say for each, and which ones an expert can undo.

const IGNORED_REASON_LABELS: Record<string, string> = {
  auto_reply: "it looked like an automatic reply",
  bulk: "it looked like bulk mail (a newsletter or a mailing list)",
  bounce: "it was a bounce",
  // Ansa's sending address or an address on its receiving domain. (Rows from
  // before step 27 also used it for the company's support addresses.)
  own_address: "it came from ansa's sending address or your forwarding address (a mail loop)",
  support_address: "it came from one of your support addresses (listed on Setup)",
  rate_limited: "too many emails from that sender this hour",
  // Not written any more (step 27: such an email becomes a ticket without a
  // customer email), but older rows have it.
  bad_sender: "it had no valid sender",
  content_unavailable: "its content could not be fetched",
  processing_error: "processing it failed",
};

// "Process again": the email runs once more, filters included.
export const PROCESS_AGAIN_REASONS = ["content_unavailable", "processing_error"];

// "Make a ticket anyway": the filters are skipped. Also for mail from the
// company's support addresses (a Google Group that put its own address in
// From, a mailbox rule that forwards as a new message): one ticket made by
// hand can't loop, and an own address is never filled in as its customer
// email. Never for mail from ansa's own addresses ("own_address"): a loop.
export const TICKET_ANYWAY_REASONS = ["auto_reply", "bulk", "bounce", "rate_limited", "bad_sender", "support_address"];

// What the page says for an ignored email's reason code.
export function describeIgnoredReason(reason: string | null): string {
  if (reason && Object.hasOwn(IGNORED_REASON_LABELS, reason)) {
    return IGNORED_REASON_LABELS[reason];
  }
  return "it was filtered out";
}
