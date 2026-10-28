import "server-only";
import { recordJobFailed, recordJobNeedsAttention, recordJobPublished, requeueClaimedJob } from "@/db/publish-outcomes";
import { readJobForPublishing, type JobForPublishing } from "@/db/publish-run-read";
import { checkClaimBeforeSending, type PublishClaim } from "@/db/publish-runs";
import { composePublishedText } from "@/lib/content-rules";
import { readPrivateFile } from "@/lib/file-storage";
import type { PublishJobErrorCode } from "@/lib/publishing/job-errors";
import { DAILY_LIMIT_WAIT_MINUTES, MAX_PUBLISH_ATTEMPTS, STALE_PUBLISHING_MINUTES } from "@/lib/publishing/limits";
import { secondsUntilNextTry } from "@/lib/publishing/retry-timing";
import { findReasonNotToPublish } from "@/lib/publishing/run-check";
import { describeErrorWithFrames } from "@/lib/safe-error-logging";
import type { SocialPlatform } from "@/lib/social-platforms";
import { LONGEST_PUBLISH_MS, publishPost } from "@/lib/social-publishing";
import type { PublishResult, SocialMedia } from "@/lib/social-types";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";
import { resolveSocialOptions, type SocialOptions } from "./social-options";
import { prepareConnectionForUse, type ConnectionForUse } from "./social-tokens";

// Sending one claimed publish job (step 41). Permission is decided NOW, at
// run time (lib/publishing/run-check.ts, on one snapshot of the job, its
// draft, its account and the people behind it), never trusted from when it
// was scheduled. Then the company's daily limit is counted, the account's
// permission made ready (renewed when it runs out soon), its image or video
// read, the claim checked once more (still this run's, with time left for
// the platform's longest answer), and the platform asked; what came of it
// is saved in one transaction (db/publish-outcomes.ts).
//
// LOGGING RULE for this file: never log a token, the post's text, a file
// key or anything a platform wrote. Fixed lines with codes and class names only.

// How long reading the draft's image or video from storage may take.
export const MEDIA_READ_TIMEOUT_MS = 30_000;

// The platform is asked only within this long of the claim, so even its
// longest answer comes before the claim counts as cut off (10 minutes) and
// the job goes to a person, who may send it again. A run gets here in about
// a minute; only a stalled database makes it later (nothing is sent then).
export const LATEST_SEND_START_MS = STALE_PUBLISHING_MINUTES * 60_000 - LONGEST_PUBLISH_MS;

export type PublishAttemptOptions = {
  social?: SocialOptions;
  // Only the checks replace it: storage that fails, or has no such file.
  readMedia?: (storageKey: string) => Promise<Buffer | null>;
};

// "held_back": the company's daily limit put it back in the queue (the
// runners give that company no more turns in the run). "lost": this run no
// longer held the job, or our own database failed: it stays as another
// writer (or the stale-claim sweep) leaves it.
export type PublishAttemptOutcome = "published" | "failed" | "needs_attention" | "requeued" | "held_back" | "lost";

// Sends one claimed job and saves what came of it. Never throws: a failure
// of our own leaves the job "publishing", and the runners hand it to a
// person once its claim is 10 minutes old (it may have gone out).
export async function sendClaimedJob(claim: PublishClaim, options: PublishAttemptOptions = {}): Promise<PublishAttemptOutcome> {
  try {
    return await checkAndSend(claim, options);
  } catch (error) {
    console.error(`Publish job run failed: ${describeErrorWithFrames(error)}`);
    return "lost";
  }
}

async function checkAndSend(claim: PublishClaim, options: PublishAttemptOptions): Promise<PublishAttemptOutcome> {
  const job = await readJobForPublishing(claim);
  if (!job) {
    return "lost";
  }
  const platform = job.check.draft.platform;
  const reason = findReasonNotToPublish(job.check);
  if (reason) {
    return fail(claim, platform, reason);
  }
  // Per company, every try counted. WHY before the account is made ready and
  // its media read: a post held back must cost nothing more (a renewal asks
  // the platform, a video is up to 100 MB), as every run meets one again.
  if (await isOverRateLimit("publish-attempts", claim.companyId, RATE_LIMITS.publishAttemptsPerCompany)) {
    console.warn(`Publish job held back: ${platform} daily_limit`);
    const held = await requeueClaimedJob(claim, { waitSeconds: DAILY_LIMIT_WAIT_MINUTES * 60, code: "daily_limit", countsAsTry: false });
    return held ? "held_back" : "lost";
  }
  const connection = await prepareConnectionForUse(claim.companyId, claim.connectionId, options.social);
  if (connection.kind !== "ready") {
    return stopForConnection(claim, platform, connection);
  }
  const media = await readMedia(job, options);
  if (media === "missing") {
    return fail(claim, platform, "media_missing");
  }
  if (media === "unavailable") {
    return tryAgainLater(claim, platform, "media_unavailable", undefined);
  }
  const claimNow = await checkClaimBeforeSending(claim, LATEST_SEND_START_MS);
  if (claimNow !== "held") {
    return claimNow === "lost" ? "lost" : putBackTooLate(claim, platform);
  }
  const resolved = resolveSocialOptions(options.social ?? {});
  const post = { text: composePublishedText(job.check.draft), title: job.check.draft.title, media };
  const requestOptions = { fetchFn: resolved.fetchFn, now: resolved.now, nodeEnv: resolved.nodeEnv };
  const result = await publishPost(connection, connection.target, post, resolved.modeOf(connection.platform), requestOptions);
  return saveResult(claim, connection.platform, result, connection.storedAccessToken);
}

// The run got to the platform too late to send safely: nothing was sent,
// so the job goes back in the queue, its try given back.
async function putBackTooLate(claim: PublishClaim, platform: SocialPlatform): Promise<PublishAttemptOutcome> {
  console.warn(`Publish job delayed: ${platform} run_too_slow`);
  const putBack = await requeueClaimedJob(claim, { waitSeconds: 0, code: "run_too_slow", countsAsTry: false });
  return putBack ? "requeued" : "lost";
}

// The account wasn't ready: nothing was sent.
function stopForConnection(claim: PublishClaim, platform: SocialPlatform, connection: Exclude<ConnectionForUse, { kind: "ready" }>) {
  switch (connection.kind) {
    case "needs_reauth":
      return fail(claim, platform, "reauthorization_needed");
    case "disconnected":
    case "not_found":
      return fail(claim, platform, "account_disconnected");
    case "unavailable":
      if (connection.code === "refresh_unavailable") {
        return tryAgainLater(claim, platform, "token_refresh_unavailable", undefined);
      }
      return fail(claim, platform, connection.code === "not_set_up" ? "platform_not_set_up" : "account_unreadable");
  }
}

// The platform's answer, saved.
async function saveResult(claim: PublishClaim, platform: SocialPlatform, result: PublishResult, storedAccessToken: string): Promise<PublishAttemptOutcome> {
  if (result.kind === "published") {
    const saved = await recordJobPublished(claim, { externalPostId: result.externalPostId, url: result.url });
    return saved ? "published" : "lost";
  }
  if (result.kind === "unclear") {
    console.warn(`Publish job needs attention: ${platform} ${result.code}`);
    return (await recordJobNeedsAttention(claim, result.code)) ? "needs_attention" : "lost";
  }
  if (result.code === "rate_limited") {
    return tryAgainLater(claim, platform, "rate_limited", result.retryAfterSeconds);
  }
  return fail(claim, platform, result.code, result.code === "token_rejected" ? { storedAccessToken } : null);
}

// Nothing went out: back in the queue for a later try, unless this was the
// last one, which fails it.
async function tryAgainLater(claim: PublishClaim, platform: SocialPlatform, code: PublishJobErrorCode, retryAfterSeconds: number | undefined): Promise<PublishAttemptOutcome> {
  if (claim.attempt >= MAX_PUBLISH_ATTEMPTS) {
    return fail(claim, platform, code);
  }
  console.warn(`Publish job delayed: ${platform} ${code}`);
  const waitSeconds = secondsUntilNextTry(claim.attempt, retryAfterSeconds);
  return (await requeueClaimedJob(claim, { waitSeconds, code, countsAsTry: true })) ? "requeued" : "lost";
}

async function fail(claim: PublishClaim, platform: SocialPlatform, code: PublishJobErrorCode, tokenRejected: { storedAccessToken: string } | null = null): Promise<PublishAttemptOutcome> {
  console.warn(`Publish job failed: ${platform} ${code}`);
  return (await recordJobFailed(claim, code, tokenRejected)) ? "failed" : "lost";
}

// The draft's image or video, as the platform gets it. "missing": not in
// storage (deleted by hand?). "unavailable": storage failed or was too slow.
async function readMedia(job: JobForPublishing, options: PublishAttemptOptions): Promise<SocialMedia | null | "missing" | "unavailable"> {
  if (!job.media) {
    return null;
  }
  const read = options.readMedia ?? ((storageKey: string) => readPrivateFile(storageKey, MEDIA_READ_TIMEOUT_MS));
  try {
    const bytes = await read(job.media.storageKey);
    return bytes ? { kind: job.media.kind, contentType: job.media.contentType, bytes, altText: job.media.altText } : "missing";
  } catch {
    return "unavailable";
  }
}
