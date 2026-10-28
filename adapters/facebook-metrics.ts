import "server-only";
import { z } from "zod";
import type { MetricsErrorCode } from "@/lib/metrics-errors";
import { API_TIMEOUT_MS, readJsonAnswer, sendToPlatform, toQueryString } from "@/lib/social-http";
import { collectedOrNothing, countSchema, metricsFailed } from "@/lib/social-metrics";
import type { AdapterContext, MetricsRequest, MetricsResult, PublishTarget } from "@/lib/social-types";
import { appSecretProof, GRAPH_URL, graphErrorSchema, THROTTLED_CODES } from "./facebook-graph";

// Facebook's numbers of one Page post (step 42; docs/research/
// social-publishing-apis.md, section 5), in one GET of the post with the
// Page's token: its shares, and the reactions and comments edges' total
// counts. The Page token reads every post of its Page. Views, viewers and
// clicks are Page insights, which need read_insights: ansa doesn't ask for
// it (lib/metric-definitions.ts). NOT TESTED against Facebook.

// limit(0): only the totals, never the people who reacted or commented
// (that Meta takes limit(0) is NOT CONFIRMED; a refusal is invalid_request).
const FIELDS = "shares,reactions.limit(0).summary(total_count),comments.limit(0).summary(true)";

const answerSchema = z.object({
  shares: z.object({ count: countSchema }).optional(),
  reactions: z.object({ summary: z.object({ total_count: countSchema }).optional() }).optional(),
  comments: z.object({ summary: z.object({ total_count: countSchema }).optional() }).optional(),
});

// Meta's error codes for reading (the error-handling guide).
const FAILED_BY_CODE: Record<number, MetricsErrorCode> = {
  190: "token_rejected",
  10: "permission_denied",
  100: "invalid_request",
  1: "server_error",
  2: "server_error",
};

// One Page post's reactions, comments and shares.
export async function fetchFacebookPostMetrics(target: PublishTarget, request: MetricsRequest, context: AdapterContext): Promise<MetricsResult> {
  if (!/^[\d_]{1,60}$/.test(request.externalPostId)) {
    return metricsFailed("invalid_request");
  }
  const query = toQueryString({
    fields: FIELDS,
    access_token: target.accessToken,
    appsecret_proof: appSecretProof(target.accessToken, context.credentials.clientSecret),
  });
  const answer = await sendToPlatform(context.fetchFn, `${GRAPH_URL}/${request.externalPostId}?${query}`, { method: "GET" }, API_TIMEOUT_MS);
  if (answer.kind === "no_answer") {
    return metricsFailed(answer.code);
  }
  if (!answer.response.ok) {
    const error = await readJsonAnswer(answer.response, graphErrorSchema);
    return metricsFailed(failureOf(answer.response.status, error?.error.code ?? null));
  }
  const post = await readJsonAnswer(answer.response, answerSchema);
  if (!post) {
    return metricsFailed("unexpected_answer");
  }
  return collectedOrNothing({
    reactions: post.reactions?.summary?.total_count ?? null,
    comments: post.comments?.summary?.total_count ?? null,
    shares: post.shares?.count ?? null,
  });
}

// What a Graph error means here: throttled, the token, a permission (10 and
// 200-299), the request itself, a temporary problem.
function failureOf(status: number, code: number | null): MetricsErrorCode {
  if (code !== null && THROTTLED_CODES.includes(code)) {
    return "rate_limited";
  }
  if (code !== null && FAILED_BY_CODE[code]) {
    return FAILED_BY_CODE[code];
  }
  if (code !== null && code >= 200 && code <= 299) {
    return "permission_denied";
  }
  return status >= 500 ? "server_error" : "unexpected_answer";
}
