import type { ContentFormat } from "@/lib/content-studio/formats";
import { metricColumns, type MetricColumn, type PostMetricValues } from "@/lib/metric-definitions";
import { localDateOf, localTimeOf, weekdayOf } from "@/lib/publishing/schedule-time";
import { SOCIAL_PLATFORM_LABELS, socialPlatforms, type SocialPlatform } from "@/lib/social-platforms";

// What a performance review (step 42) is made from, and what is stored as
// its input_summary: exactly the numbers sent. Aggregates only: per post a
// label (P1, P2, ...), its platform, format, pillar, topic and when it went
// out (weekday and hour in the owner's timezone) with its latest numbers;
// per platform and per pillar a group (G1, G2, ...) with its totals. No
// post text beyond the topic, no account, no person, no customer data.
// Pure: the service gathers the posts, the prompt and the answer's check
// read what this builds.

export type ReviewSourcePost = {
  platform: SocialPlatform;
  format: ContentFormat;
  pillar: string;
  topic: string;
  publishedAt: Date;
  simulated: boolean;
  values: PostMetricValues;
};

export type ReviewPost = {
  label: string;
  platform: SocialPlatform;
  format: ContentFormat;
  pillar: string;
  topic: string;
  weekday: string;
  hour: string;
  simulated: boolean;
  // Only the numbers the post has: a missing one is not 0.
  numbers: Partial<Record<MetricColumn, number>>;
};

// platform and pillar: by name; no_pillar: the posts that belong to none.
export type ReviewGroupKind = "platform" | "pillar" | "no_pillar";

export type ReviewGroup = {
  label: string;
  kind: ReviewGroupKind;
  name: string;
  // "posts", and per number: <metric>_total, <metric>_posts (how many posts
  // have it) and <metric>_per_post (the total over those, to one decimal).
  numbers: Record<string, number>;
};

export type ReviewInput = {
  period: { days: number; start: string; end: string };
  timeZone: string;
  // The period's posts with numbers, and how many of them the request left out.
  postCount: number;
  postsLeftOut: number;
  simulated: boolean;
  posts: ReviewPost[];
  groups: ReviewGroup[];
};

// Every key a group's numbers can have, and a post's: what evidence may cite.
export const groupNumberKeys = ["posts", ...metricColumns.flatMap((column) => [`${column}_total`, `${column}_posts`, `${column}_per_post`])];
export const citableNumberKeys = [...metricColumns, ...groupNumberKeys];

// Builds the input of one review from the period's posts with numbers
// (the newest first; at most the ones that fit), labeled in the order they
// went out. postCount: every post of the period with numbers.
export function buildReviewInput(source: {
  posts: ReviewSourcePost[];
  postCount: number;
  period: { days: number; start: Date; end: Date };
  timeZone: string;
}): ReviewInput {
  const inOrder = [...source.posts].sort((first, second) => first.publishedAt.getTime() - second.publishedAt.getTime());
  const posts = inOrder.map((post, index) => toReviewPost(post, `P${index + 1}`, source.timeZone));
  return {
    period: { days: source.period.days, start: source.period.start.toISOString(), end: source.period.end.toISOString() },
    timeZone: source.timeZone,
    postCount: source.postCount,
    postsLeftOut: Math.max(0, source.postCount - posts.length),
    simulated: posts.some((post) => post.simulated),
    posts,
    groups: buildGroups(posts),
  };
}

function toReviewPost(post: ReviewSourcePost, label: string, timeZone: string): ReviewPost {
  const numbers: Partial<Record<MetricColumn, number>> = {};
  for (const column of metricColumns) {
    const value = post.values[column];
    if (value !== null) {
      numbers[column] = value;
    }
  }
  return {
    label,
    platform: post.platform,
    format: post.format,
    pillar: post.pillar,
    topic: post.topic,
    weekday: weekdayOf(localDateOf(post.publishedAt, timeZone)),
    // The hour it went out, as HH:00: the minute says nothing more.
    hour: `${localTimeOf(post.publishedAt, timeZone).slice(0, 2)}:00`,
    simulated: post.simulated,
    numbers,
  };
}

// A group per platform (in the platforms' order), then per pillar (by name)
// and the posts without one.
function buildGroups(posts: ReviewPost[]): ReviewGroup[] {
  const groups: Omit<ReviewGroup, "label">[] = [];
  for (const platform of socialPlatforms) {
    const ofPlatform = posts.filter((post) => post.platform === platform);
    if (ofPlatform.length > 0) {
      groups.push({ kind: "platform", name: SOCIAL_PLATFORM_LABELS[platform], numbers: groupNumbers(ofPlatform) });
    }
  }
  const pillars = [...new Set(posts.map((post) => post.pillar).filter((pillar) => pillar !== ""))].sort();
  for (const pillar of pillars) {
    groups.push({ kind: "pillar", name: pillar, numbers: groupNumbers(posts.filter((post) => post.pillar === pillar)) });
  }
  // Without any pillar, the platform groups already hold every post.
  const withoutPillar = posts.filter((post) => post.pillar === "");
  if (withoutPillar.length > 0 && pillars.length > 0) {
    groups.push({ kind: "no_pillar", name: "", numbers: groupNumbers(withoutPillar) });
  }
  return groups.map((group, index) => ({ ...group, label: `G${index + 1}` }));
}

function groupNumbers(posts: ReviewPost[]): Record<string, number> {
  const numbers: Record<string, number> = { posts: posts.length };
  for (const column of metricColumns) {
    const given: number[] = [];
    for (const post of posts) {
      const value = post.numbers[column];
      if (value !== undefined) {
        given.push(value);
      }
    }
    if (given.length === 0) {
      continue;
    }
    const total = given.reduce((sum, value) => sum + value, 0);
    numbers[`${column}_total`] = total;
    numbers[`${column}_posts`] = given.length;
    numbers[`${column}_per_post`] = Math.round((total / given.length) * 10) / 10;
  }
  return numbers;
}

// Every number the input holds: a limit of the data may name only these.
export function numbersInInput(input: ReviewInput): number[] {
  const numbers = [input.period.days, input.postCount, input.posts.length, input.postsLeftOut];
  for (const post of input.posts) {
    numbers.push(...Object.values(post.numbers));
  }
  for (const group of input.groups) {
    numbers.push(...Object.values(group.numbers));
  }
  return numbers;
}
