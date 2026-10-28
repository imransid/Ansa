import { escapeHtml } from "@/lib/escape-html";
import { toPlainSingleLine } from "@/lib/plain-text";
import type { RenderedEmail } from "./ticket-solved";

type TicketAssignedInput = {
  assigneeName: string;
  ticketNumber: number;
  ticketSubject: string;
  category: string | null;
  assignedAutomatically: boolean;
  // False when routing gave it to them for another reason (the same
  // customer's other open ticket is theirs, step 29).
  assigneeHandlesCategory: boolean;
  link: string;
};

// Builds the "a ticket is yours" email for an expert. It holds the ticket's
// number, subject and category only: no customer contact details, no notes.
export function renderTicketAssignedEmail(input: TicketAssignedInput): RenderedEmail {
  // Subjects come from people, from customers' emails and from Claude: no line
  // breaks (they could forge a header) and no invisible format characters
  // (a right-to-left override could disguise the text) in the subject line.
  const cleanSubject = toPlainSingleLine(input.ticketSubject);
  const subject = `Ticket #${input.ticketNumber} is yours: ${cleanSubject}`.slice(0, 150);
  const why = describeWhy(input);

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

// Why the ticket is theirs, claiming the category only when they handle it.
function describeWhy(input: TicketAssignedInput): string {
  if (!input.assignedAutomatically) {
    return "A teammate assigned it to you.";
  }
  if (input.category && input.assigneeHandlesCategory) {
    return `It was routed to you automatically because you handle ${input.category}.`;
  }
  return "It was routed to you automatically.";
}
