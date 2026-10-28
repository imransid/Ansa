import { socialPlatforms, type SocialPlatform } from "@/lib/social-platforms";

// The numbers ansa keeps about a published post (step 42), one column each
// in post_metrics, and what each platform means by them: which column it
// fills, from which of its fields, and one line the Analytics page shows.
// Pure, so the pages, the services, the simulate command and the checks
// read one table. Every field here is one docs/research/social-publishing-
// apis.md names (section 5, checked 2026-10-28).
//
// A number a platform doesn't give is NULL, never 0 ("not available"): 0
// only ever means the platform said 0.

export const metricColumns = ["views", "reach", "reactions", "comments", "shares", "clicks", "video_views"] as const;
export type MetricColumn = (typeof metricColumns)[number];

// One post's numbers, as a snapshot holds them.
export type PostMetricValues = Record<MetricColumn, number | null>;

// Our own name of each column, where platforms are put side by side.
export const METRIC_LABELS: Record<MetricColumn, string> = {
  views: "Views",
  reach: "Reach",
  reactions: "Reactions",
  comments: "Comments",
  shares: "Shares",
  clicks: "Clicks",
  video_views: "Video views",
};

// Postgres's integer: a platform's number past it is not one ansa can keep.
export const METRIC_VALUE_MAX = 2_147_483_647;

// How many days after it went out a post's numbers are read (about once a
// day, db/post-metrics.ts). No platform's are read for longer.
export const METRICS_READ_DAYS = 30;
// X's posts for fewer: X gives link clicks only for a post's first 30 days,
// and ansa asks for them under 29 (adapters/x-metrics.ts). A read after
// that would have none and hide the ones read before, since the page and
// the review show each post's newest snapshot; the day between leaves room
// for the minutes between claiming a post and asking X.
export const X_METRICS_READ_DAYS = 28;

const DAY_MS = 24 * 60 * 60 * 1000;

// How many days after it went out ansa reads the numbers of a post on the platform.
export function metricsReadDays(platform: SocialPlatform): number {
  return platform === "x" ? X_METRICS_READ_DAYS : METRICS_READ_DAYS;
}

// Whether ansa still reads a post's numbers at `now` (the collector counts
// the same days by the database's clock).
export function areNumbersStillRead(platform: SocialPlatform, publishedAt: Date, now: Date): boolean {
  return now.getTime() - publishedAt.getTime() < metricsReadDays(platform) * DAY_MS;
}

// collected: ansa reads it from the platform's `field`. needs_permission:
// the platform gives it only to apps with `permission`, which ansa doesn't
// ask for, so it stays null. not_offered: the platform gives no such
// number for the posts ansa publishes there. label: the platform's word.
export type MetricDefinition =
  | { status: "collected"; label: string; field: string; definition: string }
  | { status: "needs_permission"; label: string; field: string; definition: string; permission: string }
  | { status: "not_offered"; definition: string };

function collected(label: string, field: string, definition: string): MetricDefinition {
  return { status: "collected", label, field, definition };
}

function needsPermission(permission: string, label: string, field: string, definition: string): MetricDefinition {
  return { status: "needs_permission", label, field, definition, permission };
}

function notOffered(definition: string): MetricDefinition {
  return { status: "not_offered", definition };
}

const LINKEDIN = "r_member_postAnalytics (LinkedIn's Community Management API, an app of its own)";
const FACEBOOK = "read_insights (and the Page's ANALYZE task)";
const YOUTUBE = "yt-analytics.readonly (the YouTube Analytics API)";

export const METRIC_DEFINITIONS: Record<SocialPlatform, Record<MetricColumn, MetricDefinition>> = {
  linkedin: {
    views: needsPermission(LINKEDIN, "Impressions", "IMPRESSION", "How many times the post was shown."),
    reach: needsPermission(LINKEDIN, "Members reached", "MEMBERS_REACHED", "How many different members saw the post."),
    reactions: needsPermission(LINKEDIN, "Reactions", "REACTION", "Reactions of every kind."),
    comments: needsPermission(LINKEDIN, "Comments", "COMMENT", "Comments on the post."),
    shares: needsPermission(LINKEDIN, "Reposts", "RESHARE", "How many times members reposted it."),
    clicks: needsPermission(LINKEDIN, "Link clicks", "LINK_CLICKS", "Clicks on a link in the post."),
    video_views: notOffered("ansa sends no videos to LinkedIn, and its member post numbers count no plays."),
  },
  facebook: {
    views: needsPermission(FACEBOOK, "Views", "post_media_view", "How often the post was on screen (Meta retired impressions in 2025-2026)."),
    reach: needsPermission(FACEBOOK, "Viewers", "post_total_media_view_unique", "How many different people saw the post."),
    reactions: collected("Reactions", "reactions.summary.total_count", "Reactions of every kind (like, love, ...)."),
    comments: collected("Comments", "comments.summary.total_count", "Comments on the post."),
    shares: collected(
      "Shares",
      "shares.count",
      "How many times the post was shared. Facebook may leave the number out until someone shares it: ansa then shows none, not 0.",
    ),
    clicks: needsPermission(FACEBOOK, "Clicks", "post_clicks", "Clicks anywhere on the post."),
    video_views: notOffered("ansa sends no videos to Facebook yet."),
  },
  x: {
    views: collected("Impressions", "public_metrics.impression_count", "How many times the post was seen."),
    reach: notOffered("X gives no count of the different people who saw a post."),
    reactions: collected("Likes", "public_metrics.like_count", "Likes of the post."),
    comments: collected("Replies", "public_metrics.reply_count", "Replies to the post."),
    shares: collected("Reposts and quotes", "public_metrics.retweet_count + quote_count", "Reposts and quote posts together."),
    clicks: collected("Link clicks", "non_public_metrics.url_link_clicks", "Clicks on a link in the post. X gives them for posts of the last 30 days only."),
    video_views: notOffered("ansa sends no videos to X yet."),
  },
  youtube: {
    views: collected("Views", "statistics.viewCount", "How many times the video was played (YouTube's live count; its Analytics numbers come 48-72 hours late)."),
    reach: notOffered("YouTube gives no count of the different people who watched one video."),
    reactions: collected("Likes", "statistics.likeCount", "Likes of the video."),
    comments: collected("Comments", "statistics.commentCount", "Comments on the video."),
    shares: needsPermission(YOUTUBE, "Shares", "shares", "How many times the video was shared."),
    clicks: notOffered("YouTube gives no click count for a video."),
    video_views: notOffered("Every view on YouTube is a video view: see Views."),
  },
};

// The columns ansa reads from a platform.
export function collectedColumns(platform: SocialPlatform): MetricColumn[] {
  return metricColumns.filter((column) => METRIC_DEFINITIONS[platform][column].status === "collected");
}

// The platforms ansa reads any number from (LinkedIn gives none to ansa's app).
export function platformsCollectingMetrics(): SocialPlatform[] {
  return socialPlatforms.filter((platform) => collectedColumns(platform).length > 0);
}

// Whether the platform has such a number at all, collected or not: what a
// simulated snapshot may hold, standing in for the platform.
export function platformOffers(platform: SocialPlatform, column: MetricColumn): boolean {
  return METRIC_DEFINITIONS[platform][column].status !== "not_offered";
}

// A snapshot with nothing in it yet.
export function emptyMetricValues(): PostMetricValues {
  return { views: null, reach: null, reactions: null, comments: null, shares: null, clicks: null, video_views: null };
}

// What the platform calls one of our columns ("Impressions" on X), or our own name.
export function metricLabel(platform: SocialPlatform, column: MetricColumn): string {
  const definition = METRIC_DEFINITIONS[platform][column];
  return definition.status === "not_offered" ? METRIC_LABELS[column] : definition.label;
}
