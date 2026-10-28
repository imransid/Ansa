import "server-only";
import { z } from "zod";
import { scheduleDraftPosts } from "@/db/publish-scheduling";
import { canManagePublishing } from "@/lib/cofounder/permissions";
import type { FormResult } from "@/lib/form-result";
import { checkScheduleTime } from "@/lib/publishing/schedule-time";
import type { SessionContext } from "@/lib/session";
import { scheduleDraftSchema } from "@/lib/validation/publishing";
import type { RunAfterResponse } from "./media-generation-jobs";
import { describeScheduleRefusal, ONLY_OWNERS_PUBLISH, tooManyPublishingChanges } from "./publish-messages";
import { runPublishJobsNow, type PublishRunOptions } from "./publish-runs";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// Scheduling a draft's posts (step 41, owners) from its page: one or more
// connected accounts of its platform, now or at a time. The browser sends
// the time as one UTC instant it made from the date and time typed in the
// viewer's own timezone; "now" is the database's clock. Everything is
// decided again in ONE transaction with the draft's row locked
// (db/publish-scheduling.ts); posts scheduled for now are sent right after
// the answer (runAfterResponse: Next's after()), each checked again first.

// Schedules one of the session company's drafts, as the version the page
// showed, to the accounts picked, now or at the time picked. Owners only.
export async function scheduleDraftForSession(
  session: SessionContext,
  input: unknown,
  runAfterResponse: RunAfterResponse,
  options: PublishRunOptions = {},
  now = new Date(),
): Promise<FormResult> {
  const parsed = scheduleDraftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  if (!canManagePublishing(session.role)) {
    return ONLY_OWNERS_PUBLISH;
  }
  const { draftId, version, connectionIds, when, scheduledFor, withoutApproval } = parsed.data;
  const at = when === "later" && scheduledFor ? new Date(scheduledFor) : null;
  const timeProblem = at ? checkScheduleTime(at, now) : "ok";
  if (timeProblem !== "ok") {
    const message = timeProblem === "past" ? "That time has passed: pick a later one, or Now." : "Pick a time within the next year.";
    return { ok: false, errors: { fieldErrors: { scheduledFor: [message] } } };
  }
  if (await isOverRateLimit("publishing-changes", session.userId, RATE_LIMITS.publishingChangesPerUser)) {
    return tooManyPublishingChanges();
  }
  const scheduled = await scheduleDraftPosts(session.companyId, session.userId, { draftId, version, connectionIds, scheduledFor: at, withoutApproval });
  if (scheduled.outcome !== "scheduled") {
    return describeScheduleRefusal(scheduled.outcome);
  }
  // Due already (now, or a time typed a moment ago): sent right after the answer.
  if (at === null || at.getTime() <= now.getTime()) {
    runAfterResponse(() => runPublishJobsNow(session.companyId, scheduled.jobIds, options));
  }
  return { ok: true };
}
