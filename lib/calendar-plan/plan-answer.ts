import { z } from "zod";
import { cutToLength } from "@/lib/cofounder/fact-proposals";
import { cleanDraftLine, cutRunsOfMarks } from "@/lib/content-studio/draft-text";
import { contentFormats, type ContentFormat } from "@/lib/content-studio/formats";
import { DRAFT_TOPIC_MAX_LENGTH } from "@/lib/content-studio/limits";
import type { ModelResult } from "@/lib/model-request";
import { PLANNED_IDEAS_MAX } from "@/lib/publishing/limits";
import { socialPlatforms, type SocialPlatform } from "@/lib/social-platforms";
import type { PlanTarget } from "./plan-prompt";

// Reading Claude's answer for "Plan the next 2 weeks" (step 41), written
// twice like every other use: the JSON schema the API enforces
// (plan-json-schema.ts) and this Zod schema. Strict: a field we didn't ask
// for (a company, a status, an approval) makes the whole answer unusable.
// Each post is then kept to what was asked, one by one: a day of those
// planned, a format the platform takes, the plan's own pillar and campaign
// names (else none), a topic of one plain line; never more posts per
// platform than its target, nor twice the same topic.

const postSchema = z
  .object({
    date: z.string(),
    time: z.string(),
    platform: z.enum(socialPlatforms),
    format: z.enum(contentFormats),
    pillar: z.string(),
    campaign: z.string(),
    topic: z.string(),
  })
  .strict();

export const calendarPlanAnswerSchema = z.object({ posts: z.array(postSchema).max(200) }).strict();

// One idea as it is saved: its day and local time, platform and format,
// the plan's pillar and campaign ("" = none) and its topic.
export type PlannedPost = { date: string; time: string; platform: SocialPlatform; format: ContentFormat; pillar: string; campaign: string; topic: string };

export type PlanAnswerContext = {
  dates: string[];
  targets: PlanTarget[];
  pillars: string[];
  campaigns: string[];
  // Topics planned on those days already, as written.
  plannedTopics: string[];
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_TIME = "09:00";

// The ideas to save, or null when there are none to read: not asked (no API
// key), refused, cut off, failed, not JSON or another shape.
export function readCalendarPlanAnswer(result: ModelResult, context: PlanAnswerContext): PlannedPost[] | null {
  if (result.kind !== "ok") {
    return null;
  }
  const parsed = calendarPlanAnswerSchema.safeParse(parseJsonOrNull(result.outputText));
  if (!parsed.success) {
    return null;
  }
  const kept: PlannedPost[] = [];
  const seenTopics = new Set(context.plannedTopics.map(topicKey));
  for (const post of parsed.data.posts) {
    const idea = cleanPost(post, context);
    if (!idea || seenTopics.has(topicKey(idea.topic)) || isPlatformFull(kept, idea.platform, context.targets) || kept.length >= PLANNED_IDEAS_MAX) {
      continue;
    }
    seenTopics.add(topicKey(idea.topic));
    kept.push(idea);
  }
  return kept;
}

// One post kept to what was asked, or null when it can't be: a day not
// planned, a platform without a target, no topic.
function cleanPost(post: z.output<typeof postSchema>, context: PlanAnswerContext): PlannedPost | null {
  const target = context.targets.find((candidate) => candidate.platform === post.platform);
  const topic = cutToLength(cutRunsOfMarks(cleanDraftLine(post.topic)), DRAFT_TOPIC_MAX_LENGTH);
  if (!target || !context.dates.includes(post.date) || topic === "") {
    return null;
  }
  return {
    date: post.date,
    time: TIME_PATTERN.test(post.time) ? post.time : DEFAULT_TIME,
    platform: post.platform,
    // A format the platform doesn't take becomes the first it does.
    format: target.formats.includes(post.format) ? post.format : target.formats[0],
    pillar: planName(post.pillar, context.pillars),
    campaign: planName(post.campaign, context.campaigns),
    topic,
  };
}

// The plan's own spelling of a name Claude gave, whatever its case; "" for
// one the plan doesn't have.
function planName(given: string, names: string[]): string {
  const wanted = given.trim().toLowerCase();
  return names.find((name) => name.trim().toLowerCase() === wanted) ?? "";
}

function isPlatformFull(kept: PlannedPost[], platform: SocialPlatform, targets: PlanTarget[]): boolean {
  const target = targets.find((candidate) => candidate.platform === platform);
  return kept.filter((idea) => idea.platform === platform).length >= (target?.posts ?? 0);
}

function topicKey(topic: string): string {
  return topic.trim().toLowerCase();
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
