import { escapeHtml } from "@/lib/escape-html";
import type { RenderedEmail } from "./ticket-solved";

type TicketAssignedInput = {
  assigneeName: string;
  ticketNumber: number;
  ticketSubject: string;
  category: string | null;
  assignedAutomatically: boolean;
  link: string;
};

// Builds the "a ticket is yours" email for an expert. It holds the ticket's
// number, subject and category only: no customer contact details, no notes.
export function renderTicketAssignedEmail(input: TicketAssignedInput): RenderedEmail {
  // Subjects come from people and from Claude: strip line breaks and other
  // control characters before they go into the email's subject line.
  const cleanSubject = input.ticketSubject.replace(/\p{Cc}/gu, " ").trim();
  const subject = `Ticket #${input.ticketNumber} is yours: ${cleanSubject}`.slice(0, 150);
  const why = input.assignedAutomatically
    ? `It was routed to you automatically${input.category ? ` because you handle ${input.category}` : ""}.`
    : "A teammate assigned it to you.";

  const text = [
    `Hi ${input.assigneeName},`,
    "",
    `Ticket #${input.ticketNumber} "${cleanSubject}" is now assigned to you. ${why}`,
    "",
    `Open it: ${input.link}`,
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="font-family: sans-serif; line-height: 1.5; color: #111;">
    <p>Hi ${escapeHtml(input.assigneeName)},</p>
    <p>Ticket #${input.ticketNumber} <strong>"${escapeHtml(cleanSubject)}"</strong> is now assigned to you. ${escapeHtml(why)}</p>
    <p><a href="${escapeHtml(input.link)}">Open ticket #${input.ticketNumber}</a></p>
  </body>
</html>`;

  return { subject, html, text };
}
