import type { AnalyticsPeriod } from "@/lib/analytics/kinds";
import type { PlatformTotals } from "@/lib/analytics/totals";
import type { DescribedEvidence } from "@/lib/performance-review/stored-review";
import type { MetricsActivity, PublishedPost } from "@/lib/types/post-metrics-reads";
import type { PublishJobListItem } from "@/lib/types/publish-jobs";

// What the Co-Founder's Analytics page shows (step 42): the company's posts
// that went out in the period with their latest numbers, the totals per
// platform, its publishing problems of the period, when numbers were last
// read, and the newest performance review. Everyone in the company reads
// it; only owners ask for a review.

// A listed post, and whether its numbers are still read (else the page
// promises no more: lib/analytics/post-notes.ts).
export type ShownPost = PublishedPost & { numbersStillRead: boolean };

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
