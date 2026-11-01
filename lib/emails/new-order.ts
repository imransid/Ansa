import { cutToLength } from "@/lib/cofounder/fact-proposals";
import { escapeHtml } from "@/lib/escape-html";
import { formatPrice } from "@/lib/menu";
import { toPlainSingleLine } from "@/lib/plain-text";
import type { RenderedEmail } from "./ticket-solved";

type NewOrderInput = {
  ownerName: string;
  orderNumber: number;
  totalCents: number;
  currency: string;
  // As the channel gave it (a Telegram name): customer-written, so one plain line, cut.
  customerName: string | null;
  channelLabel: string;
  link: string;
};

// The owner alert when a customer places an order (step 52): its number,
// who, where and ansa's total, and a link to the Orders page. Never the
// dishes, the address or the customer's messages.
export function renderNewOrderEmail(input: NewOrderInput): RenderedEmail {
  const { customer, total } = parts(input);
  const subject = `New order #${input.orderNumber} from ${customer}`.slice(0, 150);
  const text = [`Hi ${input.ownerName},`, "", `${customer} placed order #${input.orderNumber} on ${input.channelLabel}: ${total}.`, "", `Accept it on the Orders page: ${input.link}`].join("\n");
  const html = `<!doctype html>
<html>
  <body style="font-family: sans-serif; line-height: 1.5; color: #111;">
    <p>Hi ${escapeHtml(input.ownerName)},</p>
    <p><strong>${escapeHtml(customer)}</strong> placed order #${input.orderNumber} on ${escapeHtml(input.channelLabel)}: ${escapeHtml(total)}.</p>
    <p><a href="${escapeHtml(input.link)}">Accept it on the Orders page</a></p>
  </body>
</html>`;
  return { subject, html, text };
}

// The same alert as one short Telegram message from ansa's bot.
export function newOrderTelegramNote(input: Omit<NewOrderInput, "ownerName">): string {
  const { customer, total } = parts(input);
  return `New order #${input.orderNumber} from ${customer} on ${input.channelLabel}: ${total}. Accept it: ${input.link}`;
}

function parts(input: Omit<NewOrderInput, "ownerName">) {
  return {
    customer: cutToLength(toPlainSingleLine(input.customerName ?? ""), 60).trim() || "A customer",
    total: formatPrice(input.totalCents, input.currency),
  };
}
