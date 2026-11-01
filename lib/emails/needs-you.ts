import { HANDOVER_REASON_TEXT, type HandoverReason } from "@/lib/assistant/reasons";
import { cutToLength } from "@/lib/cofounder/fact-proposals";
import { escapeHtml } from "@/lib/escape-html";
import { toPlainSingleLine } from "@/lib/plain-text";
import type { RenderedEmail } from "./ticket-solved";

type NeedsYouInput = {
  ownerName: string;
  // As the channel gave it (a Telegram name): customer-written, so one plain line, cut.
  customerName: string | null;
  channelLabel: string;
  reason: HandoverReason;
  // False when the channel couldn't take a message (the reply failed to send).
  holdingReplySent: boolean;
  link: string;
};

// The owner alert when the assistant hands a conversation to a person (step
// 49): who, where and why, and a link. Never the customer's messages.
export function renderNeedsYouEmail(input: NeedsYouInput): RenderedEmail {
  const customer = cutToLength(toPlainSingleLine(input.customerName ?? ""), 60).trim() || "A customer";
  const why = HANDOVER_REASON_TEXT[input.reason];
  const subject = `${customer} needs you on ${input.channelLabel}`.slice(0, 150);
  const sent = input.holdingReplySent ? "ansa sent them your holding reply." : "No reply reached them.";
  const text = [`Hi ${input.ownerName},`, "", `${customer} needs you on ${input.channelLabel}. ${why}`, "", sent, "", `Open the conversation: ${input.link}`].join("\n");
  const html = `<!doctype html>
<html>
  <body style="font-family: sans-serif; line-height: 1.5; color: #111;">
    <p>Hi ${escapeHtml(input.ownerName)},</p>
    <p><strong>${escapeHtml(customer)}</strong> needs you on ${escapeHtml(input.channelLabel)}. ${escapeHtml(why)}</p>
    <p>${escapeHtml(sent)}</p>
    <p><a href="${escapeHtml(input.link)}">Open the conversation</a></p>
  </body>
</html>`;
  return { subject, html, text };
}

// The same alert as one short Telegram message from ansa's bot.
export function needsYouTelegramNote(input: Omit<NeedsYouInput, "ownerName">): string {
  const customer = cutToLength(toPlainSingleLine(input.customerName ?? ""), 60).trim() || "A customer";
  return `${customer} needs you on ${input.channelLabel}. ${HANDOVER_REASON_TEXT[input.reason]} Open: ${input.link}`;
}
