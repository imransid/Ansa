import "server-only";
import { getCallById, getCallsForCompany, insertCallIfNew, type CallListItem } from "@/db/calls";
import { findPhoneLineByVapiNumberId } from "@/db/phone-lines";
import { decryptText, encryptText } from "@/lib/encryption";
import type { SessionContext } from "@/lib/session";
import { callIdSchema, type EndOfCallReport } from "@/lib/validation/vapi";

// Re-exported so pages can use the type without importing from /db.
export type { CallListItem };

export type CallDetail = CallListItem & {
  transcript: string | null;
  // True when a transcript is stored but could not be decrypted (wrong key, damaged data).
  transcriptUnreadable: boolean;
};

export type SaveCallOutcome = "saved" | "duplicate" | "unknown-phone-line";

// Saves one finished call for the company that owns the phone line it came in on.
// Only call this with a report whose webhook signature was verified.
export async function saveEndOfCallReport(report: EndOfCallReport): Promise<SaveCallOutcome> {
  const { message } = report;
  // The phone line decides the company. Nothing in the payload is trusted for that.
  const line = await findPhoneLineByVapiNumberId(message.call.phoneNumberId);
  if (!line) {
    return "unknown-phone-line";
  }

  const transcript = message.artifact?.transcript ?? message.transcript ?? null;
  const isNew = await insertCallIfNew(line.companyId, {
    phoneLineId: line.id,
    vapiCallId: message.call.id,
    callerNumber: message.call.customer?.number ?? null,
    startedAt: message.startedAt ?? message.call.startedAt ?? null,
    endedAt: message.endedAt ?? message.call.endedAt ?? null,
    endedReason: message.endedReason ?? null,
    transcriptEncrypted: transcript
      ? encryptText(transcript, transcriptContext(line.companyId, message.call.id))
      : null,
  });
  return isNew ? "saved" : "duplicate";
}

// Lists the newest calls of the logged-in user's company.
export async function listCallsForSession(session: SessionContext): Promise<CallListItem[]> {
  return getCallsForCompany(session.companyId);
}

// Reads one call of the session's company and decrypts its transcript.
// Returns null for bad ids and for calls of other companies.
export async function getCallForSession(
  session: SessionContext,
  callId: unknown,
): Promise<CallDetail | null> {
  const parsed = callIdSchema.safeParse(callId);
  if (!parsed.success) {
    return null;
  }
  const call = await getCallById(session.companyId, parsed.data);
  if (!call) {
    return null;
  }

  const detail: CallDetail = {
    id: call.id,
    callerNumber: call.callerNumber,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    endedReason: call.endedReason,
    transcript: null,
    transcriptUnreadable: false,
  };
  if (!call.transcriptEncrypted) {
    return detail;
  }
  try {
    detail.transcript = decryptText(call.transcriptEncrypted, transcriptContext(call.companyId, call.vapiCallId));
  } catch {
    // Never log the ciphertext or anything from the call.
    console.error("Could not decrypt a call transcript");
    detail.transcriptUnreadable = true;
  }
  return detail;
}

// Ties each encrypted transcript to its company and call (see lib/encryption.ts).
function transcriptContext(companyId: string, vapiCallId: string): string {
  return `call-transcript:${companyId}:${vapiCallId}`;
}
