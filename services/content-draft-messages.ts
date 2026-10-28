import "server-only";
import type { DraftChangeOutcome } from "@/db/content-draft-writes";
import type { FormErrors, FormResult } from "@/lib/form-result";

// What the content studio's forms say about the outcome of a change (step
// 38), in one place, so every form words the same outcome the same way.

// What "New draft" gives back to its form: the new draft, or why not.
export type CreatedDraftResult = { ok: true; draftId: string } | { ok: false; errors: FormErrors };

export const STALE_DRAFT_MESSAGE =
  "Someone changed this draft after you opened it, so nothing was saved. Copy what you typed, reload the page and make your change again.";

// The outcome of a change to one draft, as its form shows it.
export function describeDraftOutcome(outcome: DraftChangeOutcome): FormResult {
  switch (outcome) {
    case "changed":
    case "unchanged":
      return { ok: true };
    case "not-found":
      return refused("We couldn't find that draft. Reload the page.");
    case "not-allowed":
      return refused("You can't change drafts of this company.");
    case "stale":
      return refused(STALE_DRAFT_MESSAGE);
    case "wrong-status":
      return refused("This draft's status changed meanwhile (an archived draft must be restored first). Reload the page to see it.");
  }
}

// What a change says when the person passed the content-draft-changes limit.
export function tooManyDraftChanges(): FormResult & { ok: false } {
  return refused("Too many changes. Try again in a few minutes.");
}

// A refusal with this message.
function refused(message: string): FormResult & { ok: false } {
  return { ok: false, errors: { message } };
}
