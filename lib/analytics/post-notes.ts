import { collectedColumns, metricsReadDays } from "@/lib/metric-definitions";
import { describeMetricsError } from "@/lib/metrics-errors";
import type { SocialPlatform } from "@/lib/social-platforms";

// What the Analytics page says about a post beside its numbers (step 42):
// why it has none, and what the latest try came to. Never a promise the
// collector won't keep: past its platform's read days
// (lib/metric-definitions.ts) nothing is read again. Pure.

export type PostNumbersState = {
  platform: SocialPlatform;
  accountIsStandIn: boolean;
  hasPlatformId: boolean;
  metricsError: string | null;
  // Out no longer than its platform's numbers are read.
  numbersStillRead: boolean;
};

// Why a post has no numbers, or why it never will.
export function describeWhyNoNumbers(post: PostNumbersState, platformLabel: string): string {
  if (post.accountIsStandIn) {
    return "A development stand-in's post: no platform has its numbers, so only simulated ones show.";
  }
  if (!post.hasPlatformId) {
    return `Marked as published by hand: ansa doesn't know the post's id on ${platformLabel}, so its numbers can't be read.`;
  }
  if (collectedColumns(post.platform).length === 0) {
    return `${platformLabel} gives its post numbers only with a permission ansa doesn't have yet (see What the numbers mean below).`;
  }
  if (!post.numbersStillRead) {
    return `ansa reads ${platformLabel} posts' numbers for ${metricsReadDays(post.platform)} days after they go out, and read none for this one.`;
  }
  if (post.metricsError) {
    return describeMetricsError(post.metricsError, platformLabel);
  }
  return "Not read yet: ansa reads a post's numbers about once a day, from an hour after it went out.";
}

// Why the latest try read nothing, shown under the numbers an earlier one
// read; null when it read some. Also null once the post's numbers are no
// longer read: its words may promise another try ("ansa tries again
// tomorrow"), and none comes.
export function describeLatestTryProblem(post: PostNumbersState, platformLabel: string): string | null {
  if (!post.metricsError || !post.numbersStillRead) {
    return null;
  }
  return describeMetricsError(post.metricsError, platformLabel);
}
