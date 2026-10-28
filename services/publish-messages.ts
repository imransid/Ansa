import "server-only";
import type { JobActionOutcome } from "@/db/publish-job-actions";
import type { FormResult } from "@/lib/form-result";
import type { ScheduleRefusal } from "@/lib/publishing/schedule-check";

// What the publishing forms say about an outcome (step 41), in one place,
// so every form words the same outcome the same way.

export const ONLY_OWNERS_PUBLISH: FormResult & { ok: false } = {
  ok: false,
  errors: { message: "Only owners schedule, cancel, retry or mark posts, and change the auto-publish rules." },
};

// Why a draft wasn't scheduled (or a post not tried again).
export function describeScheduleRefusal(refusal: ScheduleRefusal | "not-found" | "not-allowed" | "not-retryable"): FormResult & { ok: false } {
  switch (refusal) {
    case "not-allowed":
      return ONLY_OWNERS_PUBLISH;
    case "not-found":
      return refused("We couldn't find that draft or post. Reload the page.");
    case "not-retryable":
      return refused("This post is no longer failed or waiting for a check, so it wasn't tried again. Reload the page to see it.");
    case "stale":
      return refused("Someone changed this draft after you opened it, so nothing was scheduled. Reload the page to see their change.");
    case "wrong-status":
      return refused("This draft can't go out now: an idea, a rejected or an archived draft is never published.");
    case "not-approved":
      return refused("An owner approves this version of the draft first. (With an auto-publish rule switched on for it, you can also choose to send it without an approval.)");
    case "approver-gone":
      return refused("The owner who approved this draft is no longer an owner of the company: an owner approves it again first.");
    case "no-rule":
      return refused("No auto-publish rule that is switched on covers this draft's platform and content pillar, so it needs an owner's approval.");
    case "rule-owner-gone":
      return refused("An owner behind the auto-publish rule is no longer an owner of the company, so the rule can't send it: approve the draft instead.");
    case "format-not-published":
      return refused("ansa can't publish this kind of post to this platform yet.");
    case "blocked":
      return refused("This draft breaks one of its platform's rules or uses a word to avoid (see Checks on its page): fix it, then approve it again.");
    case "claims-need-owner":
      return refused("A claim in this draft isn't backed by a confirmed fact, or its text was changed by hand, so it can't go out without an owner's approval.");
    case "account-not-connected":
      return refused("An account you picked isn't connected any more (or isn't on this draft's platform). Reload the page and pick again.");
    case "already-scheduled":
      return refused("This draft is already scheduled, published or waiting for a check on an account you picked.");
  }
}

// What an owner's action on one post says. wrongStatus: the words when the
// post's status changed meanwhile (it went out, or someone acted first).
export function describeJobActionOutcome(outcome: JobActionOutcome, wrongStatus: string): FormResult {
  switch (outcome) {
    case "changed":
      return { ok: true };
    case "not-found":
      return refused("We couldn't find that post. Reload the page.");
    case "not-allowed":
      return ONLY_OWNERS_PUBLISH;
    case "wrong-status":
      return refused(wrongStatus);
  }
}

// What a change says when the person passed the publishing-changes limit.
export function tooManyPublishingChanges(): FormResult & { ok: false } {
  return refused("Too many changes. Try again in a few minutes.");
}

function refused(message: string): FormResult & { ok: false } {
  return { ok: false, errors: { message } };
}
