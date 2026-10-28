import "server-only";
import { askClaudeForEmailTriage } from "@/adapters/claude";
import {
  claimIgnoredInboundEmail,
  claimInboundEmail,
  markInboundEmailIgnored,
  saveInboundEmailTicket,
  type InboundEmailContentToStore,
} from "@/db/inbound-email-processing";
import { getInboundAddressesForCompany } from "@/db/inbound-emails";
import type { TicketToCreate } from "@/db/ticket-creation";
import { fetchInboundEmail, type InboundEmailContent } from "@/lib/inbound-email";
import { PROCESS_AGAIN_REASONS, TICKET_ANYWAY_REASONS } from "@/lib/inbound-email-reasons";
import type { ModelAsker } from "@/lib/model-request";
import { notifyAssignee } from "./assignment-notifications";
import { encryptForStorage, prepareEmail } from "./inbound-email-content";
import { findReasonToIgnore } from "./inbound-email-filters";
import { readSender } from "./inbound-email-sender";
import { buildFallbackTicket, triageIntoTicket } from "./inbound-email-triage";

// LOGGING RULE: never log addresses, subjects, bodies or error messages.

export type ProcessOutcome = "ticketed" | "ignored" | "not-claimed";

// Only the checks replace these, with fakes.
export type ProcessOptions = {
  fetchEmail?: (resendEmailId: string) => Promise<InboundEmailContent | null>;
  askModel?: ModelAsker;
};

type RunOptions = ProcessOptions & { applyFilters: boolean };

// Turns one received email into a ticket for a human (steps 15 and 27):
// fetch the content, skip mail that must not become a ticket, let Claude
// triage it, then save the ticket with the encrypted original. Run after the
// webhook answers, and by the scheduled job for an email whose run was cut off
// (still "received", or "processing" for 15+ minutes). Never throws.
export async function processInboundEmail(companyId: string, inboundEmailId: string, options: ProcessOptions = {}): Promise<ProcessOutcome> {
  return runClaimed(companyId, inboundEmailId, () => claimInboundEmail(companyId, inboundEmailId), { ...options, applyFilters: true });
}

// "Process again" on the Emails page: for an email whose content could not be
// fetched, whose processing failed, or whose run was cut off. The filters
// apply as usual. Never throws.
export async function processInboundEmailAgain(companyId: string, inboundEmailId: string, options: ProcessOptions = {}): Promise<ProcessOutcome> {
  const claim = async () =>
    (await claimIgnoredInboundEmail(companyId, inboundEmailId, PROCESS_AGAIN_REASONS)) ?? (await claimInboundEmail(companyId, inboundEmailId));
  return runClaimed(companyId, inboundEmailId, claim, { ...options, applyFilters: true });
}

// "Make a ticket anyway" on the Emails page: for an email the filters skipped
// (an automatic reply, bulk mail, a bounce, a flood, mail from one of the
// company's support addresses). The filters are skipped this time. Never for
// mail from ansa's own addresses (a loop). Never throws.
export async function makeTicketFromIgnoredEmail(companyId: string, inboundEmailId: string, options: ProcessOptions = {}): Promise<ProcessOutcome> {
  const claim = () => claimIgnoredInboundEmail(companyId, inboundEmailId, TICKET_ANYWAY_REASONS);
  return runClaimed(companyId, inboundEmailId, claim, { ...options, applyFilters: false });
}

// Claims one email with `claim`, fetches its content and turns it into a
// ticket (or ignores it); marks it ignored when the database itself fails.
async function runClaimed(
  companyId: string,
  inboundEmailId: string,
  claim: () => Promise<string | undefined>,
  options: RunOptions,
): Promise<ProcessOutcome> {
  try {
    const resendEmailId = await claim();
    if (!resendEmailId) {
      return "not-claimed";
    }
    const content = await (options.fetchEmail ?? fetchInboundEmail)(resendEmailId);
    if (!content) {
      await markInboundEmailIgnored(companyId, inboundEmailId, "content_unavailable", null);
      return "ignored";
    }
    return await handleContent(companyId, inboundEmailId, content, options);
  } catch (error) {
    // Only reached when the database itself fails. If marking fails too, the
    // email stays "processing" and the scheduled job runs it again later.
    console.error(`Inbound email processing failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
    await markInboundEmailIgnored(companyId, inboundEmailId, "processing_error", null).catch(() => {});
    return "ignored";
  }
}

// Everything after the content arrived. Once the email is known not to be a
// loop, whatever fails (an odd sender name, Claude's answer, a category
// renamed meanwhile, a database blip), one fallback ticket is still saved,
// without the AI's work.
async function handleContent(companyId: string, inboundEmailId: string, content: InboundEmailContent, options: RunOptions): Promise<ProcessOutcome> {
  const supportAddresses = await getInboundAddressesForCompany(companyId);
  const sender = readSender(content, supportAddresses);
  const email = prepareEmail(content);
  const stored = encryptForStorage(companyId, inboundEmailId, email, sender);
  // Mail from ansa's own addresses is a loop: never a ticket, not with "Make
  // a ticket anyway" and not as the fallback below (which saves a ticket when
  // the filters fail), so it is stopped here, before both.
  if (sender.ownAddress === "ansa") {
    await markInboundEmailIgnored(companyId, inboundEmailId, "own_address", sender.shownAddress);
    return "ignored";
  }
  try {
    const reasonToIgnore = options.applyFilters ? await findReasonToIgnore(companyId, sender, content.headers, supportAddresses) : null;
    if (reasonToIgnore) {
      await markInboundEmailIgnored(companyId, inboundEmailId, reasonToIgnore, sender.shownAddress);
      return "ignored";
    }
    const ticket = await triageIntoTicket(companyId, email, sender, options.askModel ?? askClaudeForEmailTriage);
    return await saveTicket(companyId, inboundEmailId, stored, ticket);
  } catch (error) {
    console.error(`Inbound email triage failed, saving it without the AI: ${error instanceof Error ? error.constructor.name : "unknown"}`);
    return saveTicket(companyId, inboundEmailId, stored, buildFallbackTicket(email, sender));
  }
}

// Saves the ticket and the encrypted email together, then tells whoever
// routing picked (step 13). "not-claimed" when another run finished this
// email first: it made the ticket, if any.
async function saveTicket(
  companyId: string,
  inboundEmailId: string,
  stored: InboundEmailContentToStore,
  ticket: TicketToCreate,
): Promise<ProcessOutcome> {
  const saved = await saveInboundEmailTicket(companyId, inboundEmailId, stored, ticket);
  if (!saved) {
    return "not-claimed";
  }
  if (saved.assignedToUserId) {
    await notifyAssignee({ companyId, ticketId: saved.ticketId, assigneeUserId: saved.assignedToUserId, assignedByUserId: null });
  }
  return "ticketed";
}
