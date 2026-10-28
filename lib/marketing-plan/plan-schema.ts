import { z } from "zod";
import { cutToLength } from "@/lib/cofounder/fact-proposals";
import { toPlainSingleLine } from "@/lib/plain-text";
import { socialPlatforms, type SocialPlatform } from "@/lib/social-platforms";
import { PLAN_LIST_LIMITS, POSTS_PER_WEEK_MAX } from "./limits";
import { statementBases } from "./statement-bases";

// What a marketing plan holds (step 37), as Claude writes it and as
// marketing_plans.plan stores it: the same keys, so a stored plan is read
// back with this same schema. The JSON schema sent to the API
// (plan-json-schema.ts) lists the same keys; a check keeps the two in sync.
//
// There is deliberately no company, person or version field: Claude can't
// choose what its plan belongs to. A field not listed here makes the whole
// answer unusable (.strict()).
//
// Text is cleaned and cut here, never refused for its length: a model can't
// count characters, and one long name shouldn't cost the owner a whole plan.
// Lists keep their first entries up to their most (PLAN_LIST_LIMITS). A plan
// without what it can't do without (a summary, a positioning, the fewest
// entries of a list) is unusable, like anything of another shape: nothing
// is saved (plan-answer.ts).

const CUT_MARKER = "...";

type ListLimits = { min: number; max: number };

// One plain line of text (lib/plain-text.ts), at most maxLength, never empty.
function planText(maxLength: number) {
  return z
    .string()
    .transform((text) => cutPlanText(toPlainSingleLine(text), maxLength))
    .pipe(z.string().min(1));
}

// A list of short texts: blank ones left out, the first `max` kept, at
// least `min` of them.
function planTextList(maxLength: number, limits: ListLimits) {
  return z
    .array(z.string())
    .transform((items) =>
      items
        .map((item) => cutPlanText(toPlainSingleLine(item), maxLength))
        .filter((item) => item.length > 0)
        .slice(0, limits.max),
    )
    .refine((items) => items.length >= limits.min);
}

// A list of entries: at least `min`, the first `max` kept.
function planList<Entry extends z.ZodType>(entry: Entry, limits: ListLimits) {
  return z
    .array(entry)
    .min(limits.min)
    .transform((entries) => entries.slice(0, limits.max));
}

// The platforms of one campaign, each once, at least one.
const campaignPlatformsSchema = z
  .array(z.enum(socialPlatforms))
  .transform((platforms) => [...new Set(platforms)])
  .refine((platforms) => platforms.length >= 1);

const audienceSchema = z
  .object({ name: planText(120), needs: planText(600), where_to_reach: planText(400) })
  .strict();

const goalSchema = z.object({ goal: planText(300), how_to_measure: planText(400) }).strict();

const pillarSchema = z
  .object({
    name: planText(120),
    description: planText(600),
    example_topics: planTextList(200, PLAN_LIST_LIMITS.exampleTopics),
  })
  .strict();

const campaignSchema = z
  .object({
    name: planText(120),
    objective: planText(400),
    // The name of one of the plan's pillars, as Claude wrote it.
    pillar: planText(120),
    platforms: campaignPlatformsSchema,
    timing: planText(200),
    call_to_action: planText(200),
  })
  .strict();

const cadenceEntrySchema = z
  .object({
    platform: z.enum(socialPlatforms),
    // Rounded to one decimal, as the page shows it ("0.5 posts a week").
    posts_per_week: z
      .number()
      .min(0)
      .max(POSTS_PER_WEEK_MAX)
      .transform((count) => Math.round(count * 10) / 10),
    formats: planTextList(80, PLAN_LIST_LIMITS.formats),
  })
  .strict();

const cadenceSchema = z
  .array(cadenceEntrySchema)
  .transform(keepOnePlannedEntryPerPlatform)
  .refine((entries) => entries.length >= PLAN_LIST_LIMITS.cadence.min);

// fact_topics is kept as Claude named them (each once): the fact rule
// (fact-basis.ts) needs every name to check a "fact", then keeps only the
// confirmed topics that were sent.
const statementSchema = z
  .object({
    text: planText(500),
    basis: z.enum(statementBases),
    fact_topics: z.array(z.string()).transform((topics) => [...new Set(topics)]),
  })
  .strict();

export const marketingPlanSchema = z
  .object({
    summary: planText(1_500),
    audiences: planList(audienceSchema, PLAN_LIST_LIMITS.audiences),
    positioning: planText(1_000),
    goals: planList(goalSchema, PLAN_LIST_LIMITS.goals),
    pillars: planList(pillarSchema, PLAN_LIST_LIMITS.pillars),
    campaigns: planList(campaignSchema, PLAN_LIST_LIMITS.campaigns),
    cadence: cadenceSchema,
    statements: planList(statementSchema, PLAN_LIST_LIMITS.statements),
    missing_information: planTextList(300, PLAN_LIST_LIMITS.missingInformation),
    cautions: planTextList(300, PLAN_LIST_LIMITS.cautions),
  })
  .strict();

export type MarketingPlan = z.output<typeof marketingPlanSchema>;
export type PlanStatement = MarketingPlan["statements"][number];

// Text at most maxLength long. A longer one is cut at the last space before
// the limit and marked "...". WHY not before its middle: a text with few
// spaces (Chinese, Japanese) would otherwise say almost nothing.
export function cutPlanText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  const kept = cutToLength(text, maxLength - CUT_MARKER.length);
  const lastSpace = kept.lastIndexOf(" ");
  const atWord = lastSpace >= kept.length / 2 ? kept.slice(0, lastSpace) : kept;
  return `${atWord.trimEnd()}${CUT_MARKER}`;
}

// One cadence entry per platform (the first Claude gave), none for a
// platform with no posts planned (a cadence of 0 is no cadence), and at
// most PLAN_LIST_LIMITS.cadence.max.
function keepOnePlannedEntryPerPlatform<Entry extends { platform: SocialPlatform; posts_per_week: number }>(entries: Entry[]): Entry[] {
  const seen = new Set<SocialPlatform>();
  const kept: Entry[] = [];
  for (const entry of entries) {
    if (entry.posts_per_week > 0 && !seen.has(entry.platform)) {
      seen.add(entry.platform);
      kept.push(entry);
    }
  }
  return kept.slice(0, PLAN_LIST_LIMITS.cadence.max);
}
