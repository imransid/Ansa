import "server-only";
import { askClaudeForCallDecision } from "@/adapters/claude";
import { fetchInboundEmail, type InboundEmailContent } from "@/adapters/inbound-email";
import { getActiveCategoryNames } from "@/db/categories";
import {
  claimInboundEmail,
  getInboundAddressesForCompany,
  markInboundEmailIgnored,
  saveInboundEmailTicket,
} from "@/db/inbound-emails";
import type { DecisionAsker } from "@/lib/call-brain/model-output";
import { buildEmailSlice, buildEmailTriagePrompt, EMAIL_TRIAGE_SYSTEM_PROMPT } from "@/lib/email-triage/prompt";
import { buildTriageJsonSchema, triageFromModelResult } from "@/lib/email-triage/result";
import { encryptText } from "@/lib/encryption";
import { inboundEmailBodyContext, inboundEmailSubjectContext } from "@/lib/encryption-contexts";
import { env } from "@/lib/env";
import { emailSchema } from "@/lib/validation/auth";
import { parseMailbox } from "@/lib/validation/resend";
import { newTicketSchema } from "@/lib/validation/tickets";
import { notifyAssignee } from "./assignment-notifications";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// LOGGING RULE: never log addresses, subjects, bodies or error messages.

type ProcessOptions = { fetchEmail?: (id: string) => Promise<InboundEmailContent | null>; askModel?: DecisionAsker };

// Turns one received email into a ticket for a human (step 15): fetch the
// content, skip mail that must not become a ticket, let Claude triage it, then
// save the ticket (customer email = the sender) with the encrypted original.
// Never throws. The options are only replaced by the checks, with fakes.
export async function processInboundEmail(
  companyId: string,
  inboundEmailId: string,
  { fetchEmail = fetchInboundEmail, askModel = askClaudeForCallDecision }: ProcessOptions = {},
): Promise<"ticketed" | "ignored" | "not-claimed"> {
  try {
    const resendEmailId = await claimInboundEmail(companyId, inboundEmailId);
    if (!resendEmailId) {
      return "not-claimed";
    }
    const content = await fetchEmail(resendEmailId);
    if (!content) {
      await markInboundEmailIgnored(companyId, inboundEmailId, "content_unavailable");
      return "ignored";
    }
    const sender = parseMailbox(content.from);
    const ignoreReason = await findReasonToIgnore(companyId, sender.address, content.headers);
    if (ignoreReason) {
      await markInboundEmailIgnored(companyId, inboundEmailId, ignoreReason);
      return "ignored";
    }

    const categoryNames = await getActiveCategoryNames(companyId);
    const slice = buildEmailSlice(content.subject, content.text);
    const result = await askModel({
      systemPrompt: EMAIL_TRIAGE_SYSTEM_PROMPT,
      prompt: buildEmailTriagePrompt(slice, categoryNames),
      jsonSchema: buildTriageJsonSchema(categoryNames),
    });
    const triage = triageFromModelResult(result, content.subject, categoryNames);

    const ticket = newTicketSchema.parse({
      subject: triage.ticketSubject,
      description: [triage.summary, "From a customer email. The original email is on this ticket."].filter(Boolean).join("\n\n"),
      channel: "email",
      category: triage.category,
      customerName: sender.name,
      customerEmail: sender.address,
    });
    const saved = await saveInboundEmailTicket(companyId, inboundEmailId, {
      fromAddress: sender.address,
      subjectEncrypted: encryptText(content.subject, inboundEmailSubjectContext(companyId, inboundEmailId)),
      bodyEncrypted: content.text ? encryptText(content.text, inboundEmailBodyContext(companyId, inboundEmailId)) : null,
    }, ticket);
    if (saved.assignedToUserId) {
      await notifyAssignee({ companyId, ticketId: saved.ticketId, assigneeUserId: saved.assignedToUserId, assignedByUserId: null });
    }
    return "ticketed";
  } catch (error) {
    console.error(`Inbound email processing failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
    await markInboundEmailIgnored(companyId, inboundEmailId, "processing_error").catch(() => {});
    return "ignored";
  }
}

// Mail that must not become a ticket: auto-replies, bulk mail, bounces, mail
// from our own addresses (that would loop), and floods from one sender.
async function findReasonToIgnore(companyId: string, senderAddress: string, headers: Record<string, string>): Promise<string | null> {
  if (!emailSchema.safeParse(senderAddress).success) {
    return "bad_sender";
  }
  const header = (name: string) => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1]?.toLowerCase() ?? "";
  if (header("auto-submitted") && header("auto-submitted") !== "no") {
    return "auto_reply";
  }
  if (["bulk", "junk", "list"].includes(header("precedence"))) {
    return "bulk";
  }
  if (/^(mailer-daemon|postmaster)@/.test(senderAddress)) {
    return "bounce";
  }
  const ownAddresses = [...(await getInboundAddressesForCompany(companyId)), env.EMAIL_FROM?.toLowerCase()];
  if (ownAddresses.includes(senderAddress)) {
    return "own_address";
  }
  if (await isOverRateLimit("inbound-email", `${companyId}:${senderAddress}`, RATE_LIMITS.inboundEmailsPerSender)) {
    return "rate_limited";
  }
  return null;
}
