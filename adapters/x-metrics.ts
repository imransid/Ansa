import "server-only";
import { z } from "zod";
import { API_TIMEOUT_MS, discardAnswer, readJsonAnswer, sendToPlatform } from "@/lib/social-http";
import { collectedOrNothing, countSchema, metricsFailed, metricsFailureForStatus, sumOfBoth } from "@/lib/social-metrics";
import type { AdapterContext, MetricsRequest, MetricsResult, PublishTarget } from "@/lib/social-types";

// X's numbers of one post (step 42; docs/research/social-publishing-apis.md,
// section 5): GET /2/tweets/<id> with tweet.fields public_metrics, and
// non_public_metrics (link clicks) while X still keeps them. With the
// account's own token (user context: the post is its own). Every read is
// billed ($0.005). NOT TESTED against X (IMPLEMENTATION_PLAN decision 7).

const TWEETS_URL = "https://api.x.com/2/tweets";
// X keeps the private numbers for posts of the last 30 days. A day less,
// so a post near the end isn't refused for them (X's clock and ours). The
// collector reads X's posts for a day less again (lib/metric-definitions.ts),
// so every read it makes asks for them.
const PRIVATE_NUMBERS_DAYS = 29;
const DAY_MS = 24 * 60 * 60 * 1000;

// X's problem type for a post it can't find, the same path whether it
// names api.x.com (its docs now) or api.twitter.com.
const NOT_FOUND_PROBLEM = "/2/problems/resource-not-found";

const answerSchema = z.object({
  data: z
    .object({
      public_metrics: z
        .object({
          impression_count: countSchema.optional(),
          like_count: countSchema.optional(),
          reply_count: countSchema.optional(),
          retweet_count: countSchema.optional(),
          quote_count: countSchema.optional(),
        })
        .optional(),
      non_public_metrics: z.object({ url_link_clicks: countSchema.optional() }).optional(),
    })
    .optional(),
  // Only each problem's type is read, never X's words.
  errors: z
    .array(z.object({ type: z.string().max(200).optional() }))
    .max(20)
    .optional(),
});

// One post's impressions, likes, replies, reposts and quotes, and its link
// clicks while it is young enough.
export async function fetchXPostMetrics(target: PublishTarget, request: MetricsRequest, context: AdapterContext): Promise<MetricsResult> {
  if (!/^\d{1,30}$/.test(request.externalPostId)) {
    return metricsFailed("invalid_request");
  }
  const isYoungEnough = context.now.getTime() - request.publishedAt.getTime() < PRIVATE_NUMBERS_DAYS * DAY_MS;
  const fields = isYoungEnough ? "public_metrics,non_public_metrics" : "public_metrics";
  const url = `${TWEETS_URL}/${request.externalPostId}?tweet.fields=${fields}`;
  const answer = await sendToPlatform(context.fetchFn, url, { method: "GET", headers: { Authorization: `Bearer ${target.accessToken}` } }, API_TIMEOUT_MS);
  if (answer.kind === "no_answer") {
    return metricsFailed(answer.code);
  }
  if (!answer.response.ok) {
    await discardAnswer(answer.response);
    return metricsFailed(metricsFailureForStatus(answer.response.status));
  }
  const read = await readJsonAnswer(answer.response, answerSchema);
  if (!read) {
    return metricsFailed("unexpected_answer");
  }
  // A post deleted on X: a 404 (above), or a 200 holding only the problem.
  const problems = read.errors ?? [];
  if (!read.data && problems.some((problem) => problem.type?.endsWith(NOT_FOUND_PROBLEM))) {
    return metricsFailed("not_found");
  }
  // Any other 200 without data holds no number.
  const numbers = read.data?.public_metrics;
  return collectedOrNothing({
    views: numbers?.impression_count ?? null,
    reactions: numbers?.like_count ?? null,
    comments: numbers?.reply_count ?? null,
    shares: sumOfBoth(numbers?.retweet_count, numbers?.quote_count),
    clicks: read.data?.non_public_metrics?.url_link_clicks ?? null,
  });
}
