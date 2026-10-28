import "server-only";
import { z } from "zod";
import { editContentDraft } from "@/db/content-draft-writes";
import type { FormResult } from "@/lib/form-result";
import type { SessionContext } from "@/lib/session";
import { editDraftSchema } from "@/lib/validation/content-drafts";
import { describeDraftOutcome, tooManyDraftChanges } from "./content-draft-messages";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// A person's edit of a content draft (step 38). Anyone in the company. The
// editor sends the version it opened with: a draft changed since is refused
// (never overwritten unseen), and saving a change to an approved draft makes
// it a draft again, without its approval, in the same UPDATE
// (db/content-draft-writes.ts).

// Saves the logged-in person's edit of one of their company's drafts.
export async function editDraftForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = editDraftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  if (await isOverRateLimit("content-draft-changes", session.userId, RATE_LIMITS.contentDraftChangesPerUser)) {
    return tooManyDraftChanges();
  }
  const { draftId, version, topic, pillar, campaign, ...fields } = parsed.data;
  const outcome = await editContentDraft(session.companyId, session.userId, {
    draftId,
    version,
    placement: { topic, pillar, campaign },
    fields,
  });
  return describeDraftOutcome(outcome);
}
