import { z } from "zod";
import { formatNumber } from "@/lib/analytics/format";
import { CONTENT_FORMAT_LABELS, contentFormats } from "@/lib/content-studio/formats";
import { METRIC_LABELS, metricColumns, metricLabel, type MetricColumn } from "@/lib/metric-definitions";
import { SOCIAL_PLATFORM_LABELS, socialPlatforms } from "@/lib/social-platforms";
import { performanceReviewAnswerSchema, type PerformanceReview, type ReviewEvidence } from "./review-answer";
import type { ReviewGroup, ReviewInput, ReviewPost } from "./review-input";

// A saved performance review (step 42) read back, for the Analytics page and
// the marketing planner: its input_summary and review through the shapes
// they were saved in, and each cited number described in words. A row this
// code can't read (saved by another version) shows as such. Pure.

const numbersSchema = z.record(z.string(), z.number());

const storedInputSchema = z.object({
  period: z.object({ days: z.number().int(), start: z.iso.datetime(), end: z.iso.datetime() }),
  timeZone: z.string(),
  postCount: z.number().int(),
  postsLeftOut: z.number().int(),
  simulated: z.boolean(),
  posts: z.array(
    z.object({
      label: z.string(),
      platform: z.enum(socialPlatforms),
      format: z.enum(contentFormats),
      pillar: z.string(),
      topic: z.string(),
      weekday: z.string(),
      hour: z.string(),
      simulated: z.boolean(),
      numbers: numbersSchema,
    }),
  ),
  groups: z.array(z.object({ label: z.string(), kind: z.enum(["platform", "pillar", "no_pillar"]), name: z.string(), numbers: numbersSchema })),
});

// The review with what it was made from; null when either can't be read.
export function readStoredReview(inputSummary: unknown, review: unknown): { input: ReviewInput; review: PerformanceReview } | null {
  const input = storedInputSchema.safeParse(inputSummary);
  const answer = performanceReviewAnswerSchema.safeParse(review);
  return input.success && answer.success ? { input: input.data, review: answer.data } : null;
}

// One cited number in words: where it comes from, with the label the
// finding's text uses ("P3: “Our sourdough”, LinkedIn text post, Tuesday
// 09:00"), what it counts ("Reactions per post") and its value.
export type DescribedEvidence = { source: string; metric: string; value: string; simulated: boolean };

export function describeEvidence(evidence: ReviewEvidence, input: ReviewInput): DescribedEvidence {
  const post = input.posts.find((candidate) => candidate.label === evidence.post_label);
  if (post) {
    return { source: describePost(post), metric: describePostMetric(post, evidence.metric), value: formatNumber(evidence.value), simulated: post.simulated };
  }
  const group = input.groups.find((candidate) => candidate.label === evidence.group);
  return { source: group ? describeGroup(group) : evidence.group, metric: describeGroupMetric(evidence.metric), value: formatNumber(evidence.value), simulated: input.simulated };
}

export function describePost(post: ReviewPost): string {
  return `${post.label}: “${post.topic}”, ${SOCIAL_PLATFORM_LABELS[post.platform]} ${CONTENT_FORMAT_LABELS[post.format].toLowerCase()}, ${post.weekday} ${post.hour}`;
}

export function describeGroup(group: ReviewGroup): string {
  const posts = group.numbers.posts ?? 0;
  const count = `${posts} ${posts === 1 ? "post" : "posts"}`;
  if (group.kind === "platform") {
    return `${group.label}: all ${group.name} posts (${count})`;
  }
  return group.kind === "pillar" ? `${group.label}: pillar “${group.name}” (${count})` : `${group.label}: posts without a pillar (${count})`;
}

function describePostMetric(post: ReviewPost, metric: string): string {
  return isMetricColumn(metric) ? metricLabel(post.platform, metric) : metric;
}

// "views_total" -> "Views (all posts)", "views_per_post" -> "Views per post",
// "views_posts" -> "Posts with views", "posts" -> "Posts".
function describeGroupMetric(metric: string): string {
  if (metric === "posts") {
    return "Posts";
  }
  for (const column of metricColumns) {
    const label = METRIC_LABELS[column];
    if (metric === `${column}_total`) {
      return `${label} (all posts)`;
    }
    if (metric === `${column}_per_post`) {
      return `${label} per post`;
    }
    if (metric === `${column}_posts`) {
      return `Posts with ${label.toLowerCase()}`;
    }
  }
  return metric;
}

function isMetricColumn(metric: string): metric is MetricColumn {
  return (metricColumns as readonly string[]).includes(metric);
}
