import type { PostMetricSource } from "@/lib/analytics/kinds";
import type { ContentFormat } from "@/lib/content-studio/formats";
import type { PostMetricValues } from "@/lib/metric-definitions";
import type { SocialPlatform } from "@/lib/social-platforms";

// The company's published posts with their numbers (step 42), as the
// Analytics page reads them: each post that went out in a period, with its
// latest snapshot, and when numbers were last read.

export type LatestMetrics = { collectedAt: Date; source: PostMetricSource; values: PostMetricValues };

export type PublishedPost = {
  jobId: string;
  draftId: string;
  topic: string;
  platform: SocialPlatform;
  format: ContentFormat;
  // The marketing plan's content pillar the draft belongs to ("" = none).
  pillar: string;
  accountName: string | null;
  accountIsStandIn: boolean;
  publishedAt: Date;
  // The platform's id of the post: none for a post an owner marked as published.
  hasPlatformId: boolean;
  metricsAttemptedAt: Date | null;
  metricsError: string | null;
  // null: no snapshot yet.
  latest: LatestMetrics | null;
};

export type MetricsActivity = { lastAttemptAt: Date | null; lastCollectedAt: Date | null; lastSimulatedAt: Date | null };
