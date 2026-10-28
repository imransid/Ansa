import "server-only";
import { getNewestPerformanceReview, type PerformanceReviewRow } from "@/db/performance-reviews";
import { getMetricsActivity, getPublishedPostsBetween, type MetricsActivity, type PublishedPost } from "@/db/post-metrics-reads";
import { getPublishingProblemsBetween, type PublishJobListItem } from "@/db/publish-jobs";
import type { AnalyticsPeriod } from "@/lib/analytics/kinds";
import { periodBounds } from "@/lib/analytics/periods";
import { totalsByPlatform, type PlatformTotals } from "@/lib/analytics/totals";
import { canReviewPerformance } from "@/lib/cofounder/permissions";
import { areNumbersStillRead } from "@/lib/metric-definitions";
import { postsStillNeeded } from "@/lib/performance-review/readiness";
import { describeEvidence, readStoredReview, type DescribedEvidence } from "@/lib/performance-review/stored-review";
import type { SessionContext } from "@/lib/session";
import { parseAnalyticsPeriod } from "@/lib/validation/list-queries";

// What the Co-Founder's Analytics page shows (step 42), read for the
// session's company: its posts that went out in the period with their
// latest numbers, the totals per platform, its publishing problems of the
// period, when numbers were last read, and the newest performance review.
// Everyone in the company reads it; only owners ask for a review.

// Re-exported so the page can use the types without importing from /db.
export type { MetricsActivity, PlatformTotals, PublishedPost, PublishJobListItem };

// A listed post, and whether its numbers are still read (else the page
// promises no more: lib/analytics/post-notes.ts).
export type ShownPost = PublishedPost & { numbersStillRead: boolean };

// The posts the totals are made of: more than a company can publish in 90
// days (30 tries a day), so every post of a period counts.
const POSTS_READ_MAX = 3_000;
// The posts the page lists, newest first.
const POSTS_SHOWN = 200;
const PROBLEMS_SHOWN = 50;

export type ShownReview = {
  madeAt: Date;
  madeByName: string | null;
  periodStart: Date;
  periodEnd: Date;
  // false: saved by another version in a shape this page can't read.
  readable: boolean;
  postCount: number;
  simulated: boolean;
  findings: { text: string; evidence: DescribedEvidence[] }[];
  recommendations: { text: string; basedOn: number[] }[];
  limits: string[];
};

export type AnalyticsPage = {
  period: AnalyticsPeriod;
  periodStart: Date;
  periodEnd: Date;
  // The newest posts of the period (at most POSTS_SHOWN), and how many there are.
  posts: ShownPost[];
  postCount: number;
  postsWithNumbers: number;
  totals: PlatformTotals[];
  problems: PublishJobListItem[];
  activity: MetricsActivity;
  review: ShownReview | null;
  // How many more posts with numbers a review of this period needs (0: none).
  postsNeededForReview: number;
  canReview: boolean;
};

// The session company's Analytics page for the ?period= in its address.
export async function getAnalyticsPageForSession(session: SessionContext, query: { period?: unknown }, now = new Date()): Promise<AnalyticsPage> {
  const period = parseAnalyticsPeriod(query);
  const bounds = periodBounds(period, now);
  const [posts, problems, activity, review] = await Promise.all([
    getPublishedPostsBetween(session.companyId, bounds.start, bounds.end, POSTS_READ_MAX),
    getPublishingProblemsBetween(session.companyId, bounds.start, bounds.end, PROBLEMS_SHOWN),
    getMetricsActivity(session.companyId),
    getNewestPerformanceReview(session.companyId),
  ]);
  const postsWithNumbers = posts.filter((post) => post.latest !== null).length;
  const shown = posts.slice(0, POSTS_SHOWN).map((post) => ({ ...post, numbersStillRead: areNumbersStillRead(post.platform, post.publishedAt, now) }));
  return {
    period,
    periodStart: bounds.start,
    periodEnd: bounds.end,
    posts: shown,
    postCount: posts.length,
    postsWithNumbers,
    totals: totalsByPlatform(posts),
    problems,
    activity,
    review: review ? toShownReview(review) : null,
    postsNeededForReview: postsStillNeeded(postsWithNumbers),
    canReview: canReviewPerformance(session.role),
  };
}

// A saved review as the page shows it: each cited number in words.
function toShownReview(row: PerformanceReviewRow): ShownReview {
  const shown = { madeAt: row.createdAt, madeByName: row.createdByName, periodStart: row.periodStart, periodEnd: row.periodEnd };
  const stored = readStoredReview(row.inputSummary, row.review);
  if (!stored) {
    return { ...shown, readable: false, postCount: 0, simulated: false, findings: [], recommendations: [], limits: [] };
  }
  const { input, review } = stored;
  return {
    ...shown,
    readable: true,
    postCount: input.postCount,
    simulated: input.simulated,
    findings: review.findings.map((finding) => ({ text: finding.text, evidence: finding.evidence.map((evidence) => describeEvidence(evidence, input)) })),
    recommendations: review.recommendations.map((recommendation) => ({ text: recommendation.text, basedOn: recommendation.based_on_findings })),
    limits: review.limits_of_this_data,
  };
}
