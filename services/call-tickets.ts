import "server-only";
import { REASON_LABELS, type CallDecision } from "@/lib/call-brain/decision";
import { newTicketSchema, type NewTicketInput } from "@/lib/validation/tickets";

// Used when the decision came from a rule, or Claude gave no usable subject.
const FALLBACK_TICKET_SUBJECT = "Phone call needs follow-up";

// Builds the ticket for a call that needs a human. It holds Claude's short
// summary only, in plain text. The transcript never goes on the ticket: it
// stays encrypted on the call, which the ticket links to.
export function buildCallTicket(decision: CallDecision, callerNumber: string | null): NewTicketInput {
  const descriptionParts = [
    decision.customerIssue,
    decision.explanation,
    `Escalated because: ${REASON_LABELS[decision.reasonCode]}`,
  ].filter((part): part is string => Boolean(part));

  return newTicketSchema.parse({
    subject: decision.ticketSubject ?? FALLBACK_TICKET_SUBJECT,
    description: descriptionParts.join("\n\n"),
    channel: "phone",
    // Routes the ticket to an expert for this category (step 10).
    category: decision.category,
    customerPhone: callerNumber,
  });
}
