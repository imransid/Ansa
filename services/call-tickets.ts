import "server-only";
import type { TicketToCreate } from "@/db/ticket-creation";
import type { CallDecision } from "@/lib/call-brain/decision";
import { describeReason } from "@/lib/call-brain/reasons";
import { toPlainSingleLine } from "@/lib/plain-text";
import { newTicketSchema, type NewTicketInput } from "@/lib/validation/tickets";

// Used when the decision came from a rule, or Claude gave no usable subject.
const FALLBACK_TICKET_SUBJECT = "Phone call needs follow-up";

// Builds the ticket for a call that needs a human. It holds Claude's short
// summary only, in plain text. The transcript never goes on the ticket: it
// stays encrypted on the call, which the ticket links to. errorClass: the
// class of the error when asking Claude failed, named in the reason.
export function buildCallTicket(decision: CallDecision, callerNumber: string | null, errorClass: string | null = null): NewTicketInput {
  const descriptionParts = [
    decision.customerIssue,
    decision.explanation,
    `Escalated because: ${describeReason(decision.reasonCode, errorClass)}`,
  ].filter((part): part is string => Boolean(part));

  return newTicketSchema.parse({
    subject: ticketSubjectFrom(decision.ticketSubject),
    description: descriptionParts.join("\n\n"),
    channel: "phone",
    // Routes the ticket to an expert for this category (step 10).
    category: decision.category,
    customerPhone: callerNumber,
  });
}

// What a teammate escalating a call the AI marked solved gives (step 31).
export type CallEscalationChoices = {
  // Only a claim: read as one of the company's active categories under a
  // lock in the ticket's transaction (db/ticket-creation.ts).
  categoryId: string | null;
  // Their own words: what still needs doing.
  note: string | null;
};

// Builds the ticket for a call the AI marked solved that a teammate
// escalated (step 31). Like buildCallTicket it holds Claude's short summary
// (issue: decrypted from the call, or null) and the teammate's note, in plain
// text, never the transcript nor the customer's sentence Claude quoted. The
// subject is the call fallback; anyone can edit it on the ticket page.
export function buildEscalatedCallTicket(issue: string | null, callerNumber: string | null, choices: CallEscalationChoices): TicketToCreate {
  const descriptionParts = [
    issue,
    "Escalated by a teammate: the AI marked this call solved, but it needs a person.",
    choices.note ? `What still needs doing: ${choices.note}` : null,
  ].filter((part): part is string => Boolean(part));

  const ticket = newTicketSchema.parse({
    subject: FALLBACK_TICKET_SUBJECT,
    description: descriptionParts.join("\n\n"),
    channel: "phone",
    customerPhone: callerNumber,
  });
  return { ...ticket, categoryId: choices.categoryId };
}

// Claude's subject as one plain line, or the fallback when it is blank, so a
// subject the ticket schema would refuse can't cost the call its ticket.
function ticketSubjectFrom(subject: string | null): string {
  const oneLine = toPlainSingleLine(subject ?? "").slice(0, 200).trim();
  return oneLine || FALLBACK_TICKET_SUBJECT;
}
