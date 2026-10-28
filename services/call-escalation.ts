import "server-only";
import { z } from "zod";
import { escalateSolvedCall } from "@/db/call-escalation";
import { getCallById, type CallWithEscalator } from "@/db/calls";
import { decryptForDisplay } from "@/lib/encryption";
import { callIssueContext } from "@/lib/encryption-contexts";
import type { SessionContext } from "@/lib/session";
import { escalateCallSchema } from "@/lib/validation/vapi";
import { notifyAssignee } from "./assignment-notifications";
import { buildEscalatedCallTicket } from "./call-tickets";
import type { CreatedTicketResult } from "./manual-tickets";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// "Escalate to a ticket" on a call the AI marked solved (step 31). The AI's
// verdict stays as it was, so how often it wrongly says "solved" can be
// counted: solved calls that someone escalated (calls.escalated_at).

// Escalates a call of the session's company that the AI marked solved: one
// transaction records who escalated it and creates the call's ticket (one
// per call), routed like any other; whoever routing picks is emailed.
// Anyone in the company may do this.
export async function escalateCallForSession(session: SessionContext, input: unknown): Promise<CreatedTicketResult> {
  const parsed = escalateCallSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  if (await isOverRateLimit("ticket-creations", session.userId, RATE_LIMITS.ticketCreationsPerUser)) {
    return { ok: false, errors: { message: "Too many new tickets. Try again in a few minutes." } };
  }

  const { callId, categoryId, note } = parsed.data;
  // Read only to write the ticket (Claude's summary, the caller's number);
  // whether it may be escalated is decided inside escalateSolvedCall.
  const call = await getCallById(session.companyId, callId);
  if (!call) {
    return { ok: false, errors: { message: "That call was not found in your company." } };
  }
  const ticket = buildEscalatedCallTicket(readIssue(call), call.callerNumber, { categoryId, note });
  const escalated = await escalateSolvedCall(session.companyId, call.id, session.userId, ticket);
  if (!escalated) {
    return { ok: false, errors: { message: "Only a call the AI marked solved, without a ticket yet, can be escalated. Someone may have just done it." } };
  }
  // After the save, as for every assignment (step 13).
  if (escalated.assignedToUserId) {
    await notifyAssignee({
      companyId: session.companyId,
      ticketId: escalated.ticketId,
      assigneeUserId: escalated.assignedToUserId,
      assignedByUserId: null,
    });
  }
  return { ok: true, ticketNumber: escalated.ticketNumber };
}

// Claude's short summary of the call, or null when there is none or it can't
// be decrypted (the ticket is still made, without it).
function readIssue(call: CallWithEscalator): string | null {
  return decryptForDisplay(call.aiIssueEncrypted, callIssueContext(call.companyId, call.id)).text;
}
