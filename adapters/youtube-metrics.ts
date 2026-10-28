import "server-only";
import { z } from "zod";
import { API_TIMEOUT_MS, readJsonAnswer, sendToPlatform } from "@/lib/social-http";
import { collectedOrNothing, countTextSchema, metricsFailed, metricsFailureForStatus } from "@/lib/social-metrics";
import type { AdapterContext, MetricsRequest, MetricsResult, PublishTarget } from "@/lib/social-types";

// YouTube's numbers of one video (step 42; docs/research/social-publishing-
// apis.md, section 5): the Data API's videos.list with part=statistics,
// YouTube's live counts, read with the youtube.readonly scope ansa already
// asks for (1 quota unit). Shares and watch time are in the YouTube
// Analytics API, which needs yt-analytics.readonly: ansa doesn't ask for it
// (lib/metric-definitions.ts). NOT TESTED against YouTube.

const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";

const answerSchema = z.object({
  items: z
    .array(
      z.object({
        statistics: z
          .object({
            viewCount: countTextSchema.optional(),
            likeCount: countTextSchema.optional(),
            commentCount: countTextSchema.optional(),
          })
          .optional(),
      }),
    )
    .max(5)
    .optional(),
});

// Only the reasons Google lists are read, never its message.
const googleErrorSchema = z.object({ error: z.object({ errors: z.array(z.object({ reason: z.string().max(100).optional() })).max(20).optional() }) });

// One video's views, likes and comments.
export async function fetchYouTubeVideoMetrics(target: PublishTarget, request: MetricsRequest, context: AdapterContext): Promise<MetricsResult> {
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(request.externalPostId)) {
    return metricsFailed("invalid_request");
  }
  const url = `${VIDEOS_URL}?part=statistics&id=${request.externalPostId}`;
  const answer = await sendToPlatform(context.fetchFn, url, { method: "GET", headers: { Authorization: `Bearer ${target.accessToken}` } }, API_TIMEOUT_MS);
  if (answer.kind === "no_answer") {
    return metricsFailed(answer.code);
  }
  if (!answer.response.ok) {
    // quotaExceeded: ansa's whole Google project used its day's units.
    const error = await readJsonAnswer(answer.response, googleErrorSchema);
    const reasons = (error?.error.errors ?? []).map((entry) => entry.reason ?? "");
    return metricsFailed(reasons.includes("quotaExceeded") ? "quota_exceeded" : metricsFailureForStatus(answer.response.status));
  }
  const read = await readJsonAnswer(answer.response, answerSchema);
  if (!read) {
    return metricsFailed("unexpected_answer");
  }
  const [video] = read.items ?? [];
  if (!video) {
    // An id YouTube doesn't know (deleted, or made private by its owner).
    return metricsFailed("not_found");
  }
  return collectedOrNothing({
    views: video.statistics?.viewCount ?? null,
    reactions: video.statistics?.likeCount ?? null,
    comments: video.statistics?.commentCount ?? null,
  });
}
