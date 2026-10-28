import { escapeHtml } from "@/lib/escape-html";
import { toPlainSingleLine } from "@/lib/plain-text";

type TicketSolvedEmailInput = {
  companyName: string;
  ticketNumber: number;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

// Builds the "your request has been solved" email sent to a customer: the
// same fixed text for everyone, with only the request number and the company
// name filled in. It deliberately leaves out the customer's name and the
// ticket's subject: on an email ticket whoever sent the email wrote both (a
// forged sender can put a phishing line there), and a subject may be Claude's
// note for the expert. The description holds call notes, which must never
// leave the app (Rule 1).
export function renderTicketSolvedEmail(input: TicketSolvedEmailInput): RenderedEmail {
  const companyName = toPlainSingleLine(input.companyName);
  const subject = `Your request #${input.ticketNumber} has been solved`;

  const text = [
    "Hello,",
    "",
    `Good news: your request #${input.ticketNumber} has been solved by the ${companyName} team.`,
    "",
    "If you still need help, just get in touch with us again.",
    "",
    `${companyName} Support`,
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="font-family: sans-serif; line-height: 1.5; color: #111;">
    <p>Hello,</p>
    <p>Good news: your request #${input.ticketNumber} has been solved by the ${escapeHtml(companyName)} team.</p>
    <p>If you still need help, just get in touch with us again.</p>
    <p>${escapeHtml(companyName)} Support</p>
  </body>
</html>`;

  return { subject, html, text };
}
