import "server-only";
import { bringPublishJobForward, cancelPublishJob, markJobNotPublished, markJobPublished } from "@/db/publish-job-actions";
import { getPublishJobForCompany } from "@/db/publish-jobs";
import { retryPublishJob } from "@/db/publish-scheduling";
import { canManagePublishing } from "@/lib/cofounder/permissions";
import type { FormResult } from "@/lib/form-result";
import { readPostUrl } from "@/lib/publishing/post-urls";
import type { SessionContext } from "@/lib/session";
import { SOCIAL_PLATFORM_LABELS } from "@/lib/social-platforms";
import { markPublishedSchema, publishJobIdSchema } from "@/lib/validation/publishing";
import type { RunAfterResponse } from "./media-generation-jobs";
import { describeJobActionOutcome, describeScheduleRefusal, ONLY_OWNERS_PUBLISH, tooManyPublishingChanges } from "./publish-messages";
import { runPublishJobsNow, type PublishRunOptions } from "./publish-runs";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// What an owner does to one post on the queue or a draft's page (step 41):
// cancel it while it waits, send it now, try one that failed (or needs
// attention) again, and say what became of one needing attention after
// checking the platform. Owners only (checked here for a clear message, and
// again in /db with the role read again, locked). A post sent now goes out
// right after the answer (runAfterResponse: Next's after()), checked again
// first, as every run is.

const UNKNOWN_POST: FormResult = { ok: false, errors: { message: "Unknown post. Reload the page and try again." } };

// Cancels one of the session company's waiting posts. Owners only.
export async function cancelPublishJobForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const jobId = await readJobIdWithinLimit(session, input);
  if (typeof jobId !== "string") {
    return jobId;
  }
  const outcome = await cancelPublishJob(session.companyId, session.userId, jobId);
  return describeJobActionOutcome(outcome, "This post is no longer waiting (it is going out, or went out), so it can't be canceled. Reload the page to see it.");
}

// "Publish now": sends one of the session company's waiting posts right
// after the answer. Owners only.
export async function publishJobNowForSession(session: SessionContext, input: unknown, runAfterResponse: RunAfterResponse, options: PublishRunOptions = {}): Promise<FormResult> {
  const jobId = await readJobIdWithinLimit(session, input);
  if (typeof jobId !== "string") {
    return jobId;
  }
  const outcome = await bringPublishJobForward(session.companyId, session.userId, jobId);
  if (outcome === "changed") {
    runAfterResponse(() => runPublishJobsNow(session.companyId, [jobId], options));
  }
  return describeJobActionOutcome(outcome, "This post is no longer waiting (it is going out, or went out). Reload the page to see it.");
}

// Puts one of the session company's failed (or needing attention) posts back
// in the queue, checked like a new schedule, and sends it right after the
// answer. Owners only.
export async function retryPublishJobForSession(session: SessionContext, input: unknown, runAfterResponse: RunAfterResponse, options: PublishRunOptions = {}): Promise<FormResult> {
  const jobId = await readJobIdWithinLimit(session, input);
  if (typeof jobId !== "string") {
    return jobId;
  }
  const retried = await retryPublishJob(session.companyId, session.userId, jobId);
  if (retried.outcome !== "retried") {
    return describeScheduleRefusal(retried.outcome);
  }
  runAfterResponse(() => runPublishJobsNow(session.companyId, [jobId], options));
  return { ok: true };
}

// "Mark as published": an owner checked the platform and the post that
// needed attention is there, at the address they give (optional: only one
// on the platform's own hosts is kept). Owners only.
export async function markJobPublishedForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = markPublishedSchema.safeParse(input);
  if (!parsed.success) {
    const urlProblem = parsed.error.issues.find((issue) => issue.path[0] === "postUrl");
    return urlProblem ? { ok: false, errors: { fieldErrors: { postUrl: [urlProblem.message] } } } : UNKNOWN_POST;
  }
  if (!canManagePublishing(session.role)) {
    return ONLY_OWNERS_PUBLISH;
  }
  const job = await getPublishJobForCompany(session.companyId, parsed.data.jobId);
  if (!job) {
    return describeJobActionOutcome("not-found", "");
  }
  const postUrl = parsed.data.postUrl ? readPostUrl(parsed.data.postUrl, job.platform) : null;
  if (parsed.data.postUrl && !postUrl) {
    const platform = SOCIAL_PLATFORM_LABELS[job.platform];
    return { ok: false, errors: { fieldErrors: { postUrl: [`Paste the post's address on ${platform} (https://...), or leave it empty.`] } } };
  }
  if (await isOverRateLimit("publishing-changes", session.userId, RATE_LIMITS.publishingChangesPerUser)) {
    return tooManyPublishingChanges();
  }
  const outcome = await markJobPublished(session.companyId, session.userId, parsed.data.jobId, postUrl);
  return describeJobActionOutcome(outcome, "This post no longer needs attention: someone handled it meanwhile. Reload the page to see it.");
}

// "Mark as not published": an owner checked the platform and the post that
// needed attention isn't there, so it failed (Retry may send it). Owners only.
export async function markJobNotPublishedForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const jobId = await readJobIdWithinLimit(session, input);
  if (typeof jobId !== "string") {
    return jobId;
  }
  const outcome = await markJobNotPublished(session.companyId, session.userId, jobId);
  return describeJobActionOutcome(outcome, "This post no longer needs attention: someone handled it meanwhile. Reload the page to see it.");
}

// The job id the form sent, once the person is an owner within the
// publishing-changes limit; otherwise the refusal to show.
async function readJobIdWithinLimit(session: SessionContext, input: unknown): Promise<string | FormResult> {
  const parsed = publishJobIdSchema.safeParse(input);
  if (!parsed.success) {
    return UNKNOWN_POST;
  }
  if (!canManagePublishing(session.role)) {
    return ONLY_OWNERS_PUBLISH;
  }
  if (await isOverRateLimit("publishing-changes", session.userId, RATE_LIMITS.publishingChangesPerUser)) {
    return tooManyPublishingChanges();
  }
  return parsed.data.jobId;
}
