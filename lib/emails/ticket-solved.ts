import { escapeHtml } from "@/lib/escape-html";

type TicketSolvedEmailInput = {
  companyName: string;
  customerName: string | null;
  ticketNumber: number;
  ticketSubject: string;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

// Builds the "your request has been solved" email sent to a customer.
// It deliberately leaves out the ticket description: that holds call notes,
// which must never leave the app (Rule 1).
export function renderTicketSolvedEmail(input: TicketSolvedEmailInput): RenderedEmail {
  const greetingName = input.customerName ?? "there";
  const subject = `Your request #${input.ticketNumber} has been solved`;

  const text = [
    `Hi ${greetingName},`,
    "",
    `Good news: your request "${input.ticketSubject}" (#${input.ticketNumber}) has been solved by the ${input.companyName} team.`,
    "",
    "If you still need help, just get in touch with us again.",
    "",
    `${input.companyName} Support`,
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="font-family: sans-serif; line-height: 1.5; color: #111;">
    <p>Hi ${escapeHtml(greetingName)},</p>
    <p>Good news: your request <strong>"${escapeHtml(input.ticketSubject)}"</strong> (#${input.ticketNumber}) has been solved by the ${escapeHtml(input.companyName)} team.</p>
    <p>If you still need help, just get in touch with us again.</p>
    <p>${escapeHtml(input.companyName)} Support</p>
  </body>
</html>`;

  return { subject, html, text };
}
