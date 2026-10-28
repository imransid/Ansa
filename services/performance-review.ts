import "server-only";
import { askClaudeForPerformanceReview } from "@/adapters/claude";
import { savePerformanceReview } from "@/db/performance-reviews";
import { countPublishedPostsBetween, getPostsWithNumbersBetween, type PublishedPost } from "@/db/post-metrics-reads";
import { periodBounds } from "@/lib/analytics/periods";
import { canReviewPerformance } from "@/lib/cofounder/permissions";
import type { FormErrors } from "@/lib/form-result";
import { describeModelFailure } from "@/lib/model-failure";
import type { ModelAsker, ModelResult } from "@/lib/model-request";
import { REVIEW_POSTS_MAX } from "@/lib/performance-review/limits";
import { describePostsStillNeeded, postsStillNeeded } from "@/lib/performance-review/readiness";
import { readPerformanceReviewAnswer } from "@/lib/performance-review/review-answer";
import { buildReviewInput, type ReviewSourcePost } from "@/lib/performance-review/review-input";
import { buildPerformanceReviewJsonSchema } from "@/lib/performance-review/review-json-schema";
import { buildPerformanceReviewPrompt, PERFORMANCE_REVIEW_SYSTEM_PROMPT } from "@/lib/performance-review/review-prompt";
import type { SessionContext } from "@/lib/session";
import { performanceReviewRequestSchema } from "@/lib/validation/analytics";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// "Review performance" on the Analytics page (step 42, owners): Claude
// reads one period's post numbers (aggregates only: lib/performance-
// review/review-input.ts) and writes findings that cite them and
// recommendations. This code keeps only the findings whose every number is
// exactly one it was given (lib/performance-review/review-answer.ts);
// without one left, nothing is saved. Not asked at all below 5 posts with
// numbers. The newest review is shown on the page and read by the next
// marketing plan (services/marketing-plan-inputs.ts).
//
// LOGGING RULE for this file: never log the numbers, the topics, the
// prompt, Claude's answer or any error message. Fixed strings and class
// names only.

export type PerformanceReviewResult = { ok: true } | { ok: false; errors: FormErrors };

// Reviews the session company's posts of the period the page showed, and
// saves the review. Owners only. askModel is only replaced by the checks.
export async function reviewPerformanceForSession(
  session: SessionContext,
  input: unknown,
  askModel: ModelAsker = askClaudeForPerformanceReview,
  now = new Date(),
): Promise<PerformanceReviewResult> {
  const parsed = performanceReviewRequestSchema.safeParse(input);
  if (!parsed.success) {
    return refused("Your browser didn't say its timezone. Reload the page and try again.");
  }
  if (!canReviewPerformance(session.role)) {
    return refused("Only owners ask for a performance review.");
  }
  const period = periodBounds(parsed.data.period, now);
  const counted = await countPublishedPostsBetween(session.companyId, period.start, period.end);
  if (postsStillNeeded(counted.withNumbers) > 0) {
    return refused(`${describePostsStillNeeded(counted.withNumbers)} Nothing was sent to the AI.`);
  }
  // Per company: every review is a paid Claude call.
  if (await isOverRateLimit("performance-reviews", session.companyId, RATE_LIMITS.performanceReviewsPerCompany)) {
    return refused("Your company asked for a lot of reviews this hour. Wait a while and try again.");
  }
  const posts = await getPostsWithNumbersBetween(session.companyId, period.start, period.end, REVIEW_POSTS_MAX);
  const reviewInput = buildReviewInput({ posts: posts.flatMap(toSourcePost), postCount: counted.withNumbers, period, timeZone: parsed.data.timeZone });
  const result = await askModel({
    systemPrompt: PERFORMANCE_REVIEW_SYSTEM_PROMPT,
    prompt: buildPerformanceReviewPrompt(reviewInput),
    jsonSchema: buildPerformanceReviewJsonSchema(),
  });
  const failure = describeModelFailure(result);
  if (failure) {
    console.error(`Claude call failed: ${failure}`);
  }
  const reading = readPerformanceReviewAnswer(result, reviewInput);
  if (reading.kind !== "kept") {
    return refused(describeNoReview(result, reading.kind));
  }
  const newReview = { periodStart: period.start, periodEnd: period.end, input: reviewInput, review: reading.review };
  const saved = await savePerformanceReview(session.companyId, session.userId, newReview);
  return saved.outcome === "saved" ? { ok: true } : refused("Only owners ask for a performance review.");
}

// A post as the review reads it: its numbers, never its account or text.
function toSourcePost(post: PublishedPost): ReviewSourcePost[] {
  if (!post.latest) {
    return [];
  }
  return [
    {
      platform: post.platform,
      format: post.format,
      pillar: post.pillar,
      topic: post.topic,
      publishedAt: post.publishedAt,
      simulated: post.latest.source === "dev_simulated",
      values: post.latest.values,
    },
  ];
}

// Why no review was saved, in plain words: never a server setting or an
// error's text (the log line has the class).
function describeNoReview(result: ModelResult, reading: "unusable" | "all_dropped"): string {
  if (reading === "all_dropped") {
    return "The review failed: every finding the AI wrote cited a number it wasn't given, or a wrong one, so nothing was saved. Try again.";
  }
  if (result.kind === "unavailable") {
    return "The AI isn't available right now, so no review was made. Try again later.";
  }
  if (result.kind === "ok") {
    return "The review failed: the AI's answer came back in a form that can't be used, so nothing was saved. Try again.";
  }
  return "The AI couldn't review the numbers just now, so nothing was saved. Try again in a few minutes.";
}

function refused(message: string): PerformanceReviewResult {
  return { ok: false, errors: { message } };
}
