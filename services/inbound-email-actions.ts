import "server-only";
import type { FormResult } from "@/lib/form-result";
import type { SessionContext } from "@/lib/session";
import { inboundEmailIdSchema } from "@/lib/validation/inbound-emails";
import {
  makeTicketFromIgnoredEmail,
  processInboundEmailAgain,
  type ProcessOptions,
  type ProcessOutcome,
} from "./inbound-email-processing";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// The two buttons of the Emails page (step 27). Anyone in the company may use
// them, like "Analyze now" on a call. Each run can be a paid Claude call, so
// they share one limit per person. The email must be the session's company's:
// every claim checks that in its own UPDATE.

// "Process again" for an email whose content could not be fetched, whose
// processing failed, or whose run was cut off. options: only for the checks.
export async function processEmailAgainForSession(session: SessionContext, input: unknown, options: ProcessOptions = {}): Promise<FormResult> {
  const inboundEmailId = await readInboundEmailIdWithinLimit(session, input);
  if (typeof inboundEmailId !== "string") {
    return inboundEmailId;
  }
  const outcome = await processInboundEmailAgain(session.companyId, inboundEmailId, options);
  return describeOutcome(outcome, "This email is already being processed, or was handled already.");
}

// "Make a ticket anyway" for an email the filters skipped (an automatic reply,
// bulk mail, a bounce, a flood, mail from a support address): it becomes a
// ticket without being filtered. Never for mail from ansa's own addresses (a
// loop). options: only for the checks.
export async function makeTicketFromEmailForSession(session: SessionContext, input: unknown, options: ProcessOptions = {}): Promise<FormResult> {
  const inboundEmailId = await readInboundEmailIdWithinLimit(session, input);
  if (typeof inboundEmailId !== "string") {
    return inboundEmailId;
  }
  const outcome = await makeTicketFromIgnoredEmail(session.companyId, inboundEmailId, options);
  return describeOutcome(outcome, "This email can't be made a ticket: it is not one the filters skipped, or it was handled already.");
}

// The email's id from the form, or the answer to give when it is missing or
// the person is over the limit.
async function readInboundEmailIdWithinLimit(session: SessionContext, input: unknown): Promise<string | FormResult> {
  const parsed = inboundEmailIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "Unknown email." } };
  }
  if (await isOverRateLimit("email-retries", session.userId, RATE_LIMITS.emailRetriesPerUser)) {
    return { ok: false, errors: { message: "Too many tries. Try again in a few minutes." } };
  }
  return parsed.data.inboundEmailId;
}

// Turns what processing did into the Emails page's answer.
function describeOutcome(outcome: ProcessOutcome, notClaimedMessage: string): FormResult {
  if (outcome === "ticketed") {
    return { ok: true };
  }
  if (outcome === "not-claimed") {
    return { ok: false, errors: { message: notClaimedMessage } };
  }
  // Ignored again: the list shows why.
  return { ok: false, errors: { message: "It did not become a ticket this time either. The list says why." } };
}
