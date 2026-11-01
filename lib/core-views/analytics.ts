import "server-only";
import type { AnalyticsPeriod, PostMetricSource } from "@/lib/analytics/kinds";
import { callCore } from "@/lib/core-api";
import { toFormErrors } from "@/lib/core-views/auth";
import { toPublishJobListItem, type CorePublishJob } from "@/lib/core-views/queue";
import type { PostMetricValues } from "@/lib/metric-definitions";
import type { AnalyticsPage, MetricsActivity, PlatformTotals, ShownPost, ShownReview } from "@/services/analytics-page";
import type { PerformanceReviewResult } from "@/services/performance-review";

// The Co-Founder's Analytics page and "Review performance" through the new
// backend (core's /api/v1/cofounder/analytics), in the shapes the page and
// its form already read.

// A listed post as core sends it: its times as ISO strings. (Core also
// words why it has no numbers; the page words that itself, the same way.)
type CorePost = Omit<ShownPost, "publishedAt" | "metricsAttemptedAt" | "latest"> & {
  publishedAt: string;
  metricsAttemptedAt: string | null;
  latest: { collectedAt: string; source: PostMetricSource; values: PostMetricValues } | null;
};

type CoreReview = Omit<ShownReview, "madeAt" | "periodStart" | "periodEnd"> & { madeAt: string; periodStart: string; periodEnd: string };

type CoreAnalyticsPage = {
  period: AnalyticsPeriod;
  periodStart: string;
  periodEnd: string;
  posts: CorePost[];
  postCount: number;
  postsWithNumbers: number;
  // Already in the page's shape: each number's total, or why there is none.
  totals: PlatformTotals[];
  problems: CorePublishJob[];
  activity: { lastAttemptAt: string | null; lastCollectedAt: string | null; lastSimulatedAt: string | null };
  review: CoreReview | null;
  postsNeededForReview: number;
  canReview: boolean;
};

function dateOrNull(iso: string | null): Date | null {
  return iso ? new Date(iso) : null;
}

function toShownPost(post: CorePost): ShownPost {
  const latest = post.latest ? { collectedAt: new Date(post.latest.collectedAt), source: post.latest.source, values: post.latest.values } : null;
  return { ...post, publishedAt: new Date(post.publishedAt), metricsAttemptedAt: dateOrNull(post.metricsAttemptedAt), latest };
}

function toShownReview(review: CoreReview): ShownReview {
  return { ...review, madeAt: new Date(review.madeAt), periodStart: new Date(review.periodStart), periodEnd: new Date(review.periodEnd) };
}

function toMetricsActivity(activity: CoreAnalyticsPage["activity"]): MetricsActivity {
  return {
    lastAttemptAt: dateOrNull(activity.lastAttemptAt),
    lastCollectedAt: dateOrNull(activity.lastCollectedAt),
    lastSimulatedAt: dateOrNull(activity.lastSimulatedAt),
  };
}

// The period's posts with their newest numbers, the totals per platform,
// the period's publishing problems, when numbers were last read, the
// newest review, and whether this person may ask for one (owners).
export async function getAnalyticsPageFromCore(period: AnalyticsPeriod): Promise<AnalyticsPage> {
  const answer = await callCore<CoreAnalyticsPage>("GET", `/api/v1/cofounder/analytics?period=${period}`);
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  const page = answer.data;
  return {
    period: page.period,
    periodStart: new Date(page.periodStart),
    periodEnd: new Date(page.periodEnd),
    posts: page.posts.map(toShownPost),
    postCount: page.postCount,
    postsWithNumbers: page.postsWithNumbers,
    totals: page.totals,
    problems: page.problems.map(toPublishJobListItem),
    activity: toMetricsActivity(page.activity),
    review: page.review ? toShownReview(page.review) : null,
    postsNeededForReview: page.postsNeededForReview,
    canReview: page.canReview,
  };
}

// "Review performance" for the period the page showed, in the browser's
// own timezone. Waits for the AI (core gives it up to 270 seconds).
export async function reviewPerformanceThroughCore(period: unknown, timeZone: unknown): Promise<PerformanceReviewResult> {
  const answer = await callCore("POST", "/api/v1/cofounder/analytics/review", {
    period: typeof period === "string" ? period : "",
    timeZone: typeof timeZone === "string" ? timeZone : "",
  });
  return answer.ok ? { ok: true } : { ok: false, errors: toFormErrors(answer) };
}
