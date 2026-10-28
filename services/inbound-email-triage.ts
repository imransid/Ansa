import "server-only";
import { getActiveCategories } from "@/db/categories";
import type { TicketToCreate } from "@/db/ticket-creation";
import { buildEmailSlice, buildEmailTriagePrompt, EMAIL_TRIAGE_SYSTEM_PROMPT } from "@/lib/email-triage/prompt";
import { buildTriageJsonSchema, triageFromModelResult, triageWithoutModel, type EmailTriage } from "@/lib/email-triage/result";
import { describeModelFailure } from "@/lib/model-failure";
import type { ModelAsker } from "@/lib/model-request";
import { newTicketSchema } from "@/lib/validation/tickets";
import type { PreparedEmail } from "./inbound-email-content";
import type { EmailSender } from "./inbound-email-sender";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// LOGGING RULE: never log addresses, subjects, bodies, Claude's answer or
// error messages. Fixed strings and class names only.

const EMAIL_TICKET_NOTE = "From a customer email. The original email is on this ticket.";

// Lets Claude triage one received email (summary, subject, category) and
// builds its ticket. The category is passed by id, so an owner renaming it
// while Claude thinks is followed (db/ticket-creation.ts). Over the company's
// hourly cap Claude is not asked: the ticket gets the email's own subject and
// no category (so no routing and no assignment email either), and says why.
export async function triageIntoTicket(
  companyId: string,
  email: PreparedEmail,
  sender: EmailSender,
  askModel: ModelAsker,
): Promise<TicketToCreate> {
  const categories = await getActiveCategories(companyId);
  const triage = await triageEmail(companyId, email, categories.map((category) => category.name), askModel);
  const categoryId = categories.find((category) => category.name === triage.category)?.id ?? null;
  return { ...newTicketSchema.parse(ticketFields(triage, sender)), categoryId };
}

// The ticket made when anything went wrong after the email's content arrived
// (step 27): the email's own subject, no summary, no category, and the
// sender's name and address only if they pass the ticket's checks. So only a
// database outage can stop an email from becoming a ticket.
export function buildFallbackTicket(email: PreparedEmail, sender: EmailSender): TicketToCreate {
  const triage = triageWithoutModel(email.subject, "processing the email failed, so it was saved without the AI");
  const withSender = newTicketSchema.safeParse(ticketFields(triage, sender));
  if (withSender.success) {
    return withSender.data;
  }
  return newTicketSchema.parse(ticketFields(triage, null));
}

// Asks Claude for the summary, subject and category of one email (within the
// company's hourly cap), or makes the triage without it.
async function triageEmail(companyId: string, email: PreparedEmail, categoryNames: string[], askModel: ModelAsker): Promise<EmailTriage> {
  // WHY a cap per company: From can't be trusted, so one sender changing
  // address every time gets past the per-sender flood limit. This bounds the
  // paid Claude calls (and the assignment emails routing would send).
  if (await isOverRateLimit("email-triage", companyId, RATE_LIMITS.emailTriagesPerCompany)) {
    console.warn("Email triage skipped: company hourly limit reached");
    const limit = RATE_LIMITS.emailTriagesPerCompany.maxAttempts;
    return triageWithoutModel(email.subject, `more than ${limit} emails reached your company this hour, so the AI skipped this one`);
  }
  const slice = buildEmailSlice(email.subject, email.body);
  const result = await askModel({
    systemPrompt: EMAIL_TRIAGE_SYSTEM_PROMPT,
    prompt: buildEmailTriagePrompt(slice, categoryNames),
    jsonSchema: buildTriageJsonSchema(categoryNames),
  });
  const failure = describeModelFailure(result);
  if (failure) {
    // One fixed line with the class: a revoked key (AuthenticationError) and
    // a wrong model name (NotFoundError) need different fixes.
    console.error(`Claude call failed: ${failure}`);
  }
  return triageFromModelResult(result, email.subject, categoryNames);
}

// The new ticket's fields from the triage and the sender (null: leave the sender out).
function ticketFields(triage: EmailTriage, sender: EmailSender | null) {
  const missingAiNote = triage.missingAiReason ? `No AI summary or category: ${triage.missingAiReason}.` : null;
  return {
    subject: triage.ticketSubject,
    description: [triage.summary, EMAIL_TICKET_NOTE, missingAiNote].filter(Boolean).join("\n\n"),
    channel: "email" as const,
    category: triage.category,
    customerName: sender?.name ?? null,
    // Anyone can write any address in From, and the "solved" email goes to
    // the customer email: only a verified sender is filled in on its own
    // (step 25). Not even then when a different Reply-To says the customer is
    // someone else: a contact form's relay sends from its own address. The
    // page suggests both for an expert to confirm (step 9 flow). Never one of
    // our own addresses either (mail from the company's own mailbox made a
    // ticket by hand): the customer is someone else.
    customerEmail: sender?.verified && !sender.replyToAddress && !sender.ownAddress ? sender.address : null,
  };
}
