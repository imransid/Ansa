import { METRIC_DEFINITIONS, metricColumns, type MetricColumn, type PostMetricValues } from "@/lib/metric-definitions";
import { socialPlatforms, type SocialPlatform } from "@/lib/social-platforms";
import type { PostMetricSource } from "./kinds";

// The Analytics page's totals per platform (step 42): for each number, the
// sum over the period's posts whose latest snapshot has it. A post without
// the number adds nothing (it is not 0), and a number the platform doesn't
// give says so instead of showing 0. Pure.

export type TotalsSourcePost = {
  platform: SocialPlatform;
  latest: { source: PostMetricSource; values: PostMetricValues } | null;
};

// total: the sum, and how many posts had the number. not_offered: the
// platform has no such number. not_collected: it has, but only with a
// permission ansa doesn't ask for. no_numbers_yet: ansa reads it, and no
// post of the period has it yet.
export type MetricTotal =
  | { kind: "total"; value: number; posts: number }
  | { kind: "not_offered" }
  | { kind: "not_collected"; permission: string }
  | { kind: "no_numbers_yet" };

export type PlatformTotals = {
  platform: SocialPlatform;
  posts: number;
  postsWithNumbers: number;
  // Some of the numbers were simulated (development).
  simulated: boolean;
  metrics: Record<MetricColumn, MetricTotal>;
};

// One entry per platform that has posts in the period, in the platforms' order.
export function totalsByPlatform(posts: TotalsSourcePost[]): PlatformTotals[] {
  return socialPlatforms.flatMap((platform) => {
    const ofPlatform = posts.filter((post) => post.platform === platform);
    return ofPlatform.length > 0 ? [totalsOf(platform, ofPlatform)] : [];
  });
}

function totalsOf(platform: SocialPlatform, posts: TotalsSourcePost[]): PlatformTotals {
  const snapshots = posts.flatMap((post) => (post.latest ? [post.latest] : []));
  const metrics = Object.fromEntries(metricColumns.map((column) => [column, totalOf(platform, column, snapshots)])) as Record<MetricColumn, MetricTotal>;
  return {
    platform,
    posts: posts.length,
    postsWithNumbers: snapshots.length,
    simulated: snapshots.some((snapshot) => snapshot.source === "dev_simulated"),
    metrics,
  };
}

function totalOf(platform: SocialPlatform, column: MetricColumn, snapshots: { values: PostMetricValues }[]): MetricTotal {
  const definition = METRIC_DEFINITIONS[platform][column];
  if (definition.status === "not_offered") {
    return { kind: "not_offered" };
  }
  const given: number[] = [];
  for (const snapshot of snapshots) {
    const value = snapshot.values[column];
    if (value !== null) {
      given.push(value);
    }
  }
  if (given.length > 0) {
    return { kind: "total", value: given.reduce((sum, value) => sum + value, 0), posts: given.length };
  }
  return definition.status === "needs_permission" ? { kind: "not_collected", permission: definition.permission } : { kind: "no_numbers_yet" };
}
