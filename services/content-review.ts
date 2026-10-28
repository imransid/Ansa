import "server-only";
import { approveContentDraft, archiveContentDraft, rejectContentDraft, restoreContentDraft, type ApproveOutcome } from "@/db/content-draft-status";
import { canReviewContentDrafts } from "@/lib/cofounder/permissions";
import type { FormResult } from "@/lib/form-result";
import type { SessionContext } from "@/lib/session";
import { approveDraftSchema, draftIdOnlySchema, rejectDraftSchema } from "@/lib/validation/content-drafts";
import { describeDraftOutcome, tooManyDraftChanges } from "./content-draft-messages";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// Deciding about content drafts (step 38): owners approve and reject
// (checked here for a clear message, and again in /db, locked, in the
// transaction that writes); anyone in the company archives and restores.

const ONLY_OWNERS: FormResult = { ok: false, errors: { message: "Only owners can approve or reject drafts." } };
const UNKNOWN_DRAFT: FormResult = { ok: false, errors: { message: "Unknown draft. Reload the page and try again." } };

// Approves one of the session company's drafts as the version the page
// showed: only with no blocking issue, and with "I checked these claims"
// ticked when a claim isn't backed by a confirmed fact. Owners only.
export async function approveDraftForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = approveDraftSchema.safeParse(input);
  if (!parsed.success) {
    return UNKNOWN_DRAFT;
  }
  const refusal = await refuseUnlessOwnerWithinLimit(session);
  if (refusal) {
    return refusal;
  }
  return describeApproval(await approveContentDraft(session.companyId, session.userId, parsed.data));
}

// Rejects one of the session company's drafts as the version the page
// showed, with an optional note. Owners only.
export async function rejectDraftForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = rejectDraftSchema.safeParse(input);
  if (!parsed.success) {
    const noteProblem = parsed.error.issues.find((issue) => issue.path[0] === "note");
    return noteProblem ? { ok: false, errors: { fieldErrors: { note: [noteProblem.message] } } } : UNKNOWN_DRAFT;
  }
  const refusal = await refuseUnlessOwnerWithinLimit(session);
  if (refusal) {
    return refusal;
  }
  const outcome = await rejectContentDraft(session.companyId, session.userId, parsed.data);
  return outcome === "not-allowed" ? ONLY_OWNERS : describeDraftOutcome(outcome);
}

// Archives one of the session company's drafts. Anyone in the company.
export async function archiveDraftForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = draftIdOnlySchema.safeParse(input);
  if (!parsed.success) {
    return UNKNOWN_DRAFT;
  }
  if (await isOverRateLimit("content-draft-changes", session.userId, RATE_LIMITS.contentDraftChangesPerUser)) {
    return tooManyDraftChanges();
  }
  return describeDraftOutcome(await archiveContentDraft(session.companyId, session.userId, parsed.data.draftId));
}

// Restores one of the session company's archived drafts, to be approved
// again. Anyone in the company.
export async function restoreDraftForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = draftIdOnlySchema.safeParse(input);
  if (!parsed.success) {
    return UNKNOWN_DRAFT;
  }
  if (await isOverRateLimit("content-draft-changes", session.userId, RATE_LIMITS.contentDraftChangesPerUser)) {
    return tooManyDraftChanges();
  }
  return describeDraftOutcome(await restoreContentDraft(session.companyId, session.userId, parsed.data.draftId));
}

// Owners only, and within the content-draft-changes limit. Null when the
// decision may go ahead.
async function refuseUnlessOwnerWithinLimit(session: SessionContext): Promise<FormResult | null> {
  if (!canReviewContentDrafts(session.role)) {
    return ONLY_OWNERS;
  }
  if (await isOverRateLimit("content-draft-changes", session.userId, RATE_LIMITS.contentDraftChangesPerUser)) {
    return tooManyDraftChanges();
  }
  return null;
}

// What the Approve button says about the outcome.
function describeApproval(result: ApproveOutcome): FormResult {
  switch (result.outcome) {
    case "approved":
      return { ok: true };
    case "blocked":
      return { ok: false, errors: { message: `This draft can't be approved yet: ${result.issues.map((issue) => issue.message).join(" ")}` } };
    case "claims-not-checked":
      return {
        ok: false,
        errors: { message: "Some claims aren't backed by a confirmed fact, or were never checked: read them, then tick \"I checked these claims\"." },
      };
    case "not-allowed":
      return ONLY_OWNERS;
    default:
      return describeDraftOutcome(result.outcome);
  }
}
