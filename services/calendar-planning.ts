import "server-only";
import { askClaudeForCalendarPlan } from "@/adapters/claude";
import { getPlannedDraftsBetween, savePlannedIdeas } from "@/db/content-calendar";
import { getPublishJobsBetween } from "@/db/publish-jobs";
import { readCalendarPlanAnswer } from "@/lib/calendar-plan/plan-answer";
import { buildCalendarPlanJsonSchema } from "@/lib/calendar-plan/plan-json-schema";
import { buildCalendarPlanPrompt, CALENDAR_PLAN_SYSTEM_PROMPT, planTargets, type CalendarPlanInputs } from "@/lib/calendar-plan/plan-prompt";
import { canPlanContentCalendar } from "@/lib/cofounder/permissions";
import type { FormErrors } from "@/lib/form-result";
import type { MarketingPlan } from "@/lib/marketing-plan/plan-schema";
import { describeModelFailure } from "@/lib/model-failure";
import type { ModelAsker, ModelResult } from "@/lib/model-request";
import { PLANNING_DAYS } from "@/lib/publishing/limits";
import { addDays, localDateOf, wallClockToUtc } from "@/lib/publishing/schedule-time";
import type { SessionContext } from "@/lib/session";
import { calendarPlanSchema } from "@/lib/validation/publishing";
import { readCurrentPlan } from "./content-generation-inputs";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// "Plan the next 2 weeks" on the calendar (step 41, owners): Claude
// proposes posts from the current marketing plan's pillars, campaigns and
// cadence, and each becomes an idea (a draft with its topic only) planned
// for a day and a time in the owner's own timezone. Nothing is written,
// approved or scheduled. Without a usable answer nothing is saved.
//
// LOGGING RULE for this file: never log the plan, the topics, the prompt,
// Claude's answer or any error message. Fixed strings and class names only.

export type CalendarPlanResult = { ok: true; added: number } | { ok: false; errors: FormErrors };

// The most topics already planned that the request names.
const ALREADY_PLANNED_SHOWN = 100;

// Plans the next 14 days of the session company's posts as ideas, from its
// current marketing plan. Owners only. askModel is only replaced by the checks.
export async function planNextTwoWeeksForSession(
  session: SessionContext,
  input: unknown,
  askModel: ModelAsker = askClaudeForCalendarPlan,
  now = new Date(),
): Promise<CalendarPlanResult> {
  const parsed = calendarPlanSchema.safeParse(input);
  if (!parsed.success) {
    return refused("Your browser didn't say its timezone. Reload the page and try again.");
  }
  if (!canPlanContentCalendar(session.role)) {
    return refused("Only owners plan the calendar with the AI.");
  }
  const plan = await readCurrentPlan(session.companyId);
  if (!plan) {
    return refused("There is no marketing plan yet: make one on the Strategy page first. The calendar is planned from its content pillars and how often to post.");
  }
  // Per company: every plan is a paid Claude call.
  if (await isOverRateLimit("calendar-plans", session.companyId, RATE_LIMITS.calendarPlansPerCompany)) {
    return refused("Your company asked the AI to plan the calendar a lot this hour. Wait a while and try again.");
  }
  const { timeZone } = parsed.data;
  const inputs = await gatherInputs(session.companyId, plan.content, timeZone, now);
  const result = await askModel({ systemPrompt: CALENDAR_PLAN_SYSTEM_PROMPT, prompt: buildCalendarPlanPrompt(inputs), jsonSchema: buildCalendarPlanJsonSchema() });
  const failure = describeModelFailure(result);
  if (failure) {
    console.error(`Claude call failed: ${failure}`);
  }
  const context = {
    dates: inputs.dates,
    targets: inputs.targets,
    pillars: plan.content.pillars.map((pillar) => pillar.name),
    campaigns: plan.content.campaigns.map((campaign) => campaign.name),
    plannedTopics: inputs.alreadyPlanned.map((post) => post.topic),
  };
  const posts = readCalendarPlanAnswer(result, context);
  if (!posts || posts.length === 0) {
    return refused(describeNoPlan(result, posts));
  }
  const ideas = posts.flatMap((post) => {
    const plannedFor = wallClockToUtc({ date: post.date, time: post.time }, timeZone);
    return plannedFor ? [{ platform: post.platform, format: post.format, topic: post.topic, pillar: post.pillar, campaign: post.campaign, plannedFor }] : [];
  });
  const saved = await savePlannedIdeas(session.companyId, session.userId, ideas);
  return saved.outcome === "saved" ? { ok: true, added: saved.draftIds.length } : refused("Only owners plan the calendar with the AI.");
}

// The request: the next 14 days from tomorrow in the owner's timezone, how
// many posts each platform of the cadence gets, the plan's pillars and
// campaigns, and what is planned on those days already.
async function gatherInputs(companyId: string, plan: MarketingPlan, timeZone: string, now: Date): Promise<CalendarPlanInputs> {
  const today = localDateOf(now, timeZone);
  const dates = Array.from({ length: PLANNING_DAYS }, (_unused, index) => addDays(today, index + 1));
  const from = wallClockToUtc({ date: dates[0], time: "00:00" }, timeZone) ?? now;
  const to = wallClockToUtc({ date: addDays(dates[dates.length - 1], 1), time: "00:00" }, timeZone) ?? now;
  const [drafts, jobs] = await Promise.all([
    getPlannedDraftsBetween(companyId, from, to, ALREADY_PLANNED_SHOWN),
    getPublishJobsBetween(companyId, from, to, ALREADY_PLANNED_SHOWN),
  ]);
  const alreadyPlanned = [
    ...drafts.map((draft) => ({ date: localDateOf(draft.plannedFor, timeZone), platform: draft.platform, topic: draft.topic })),
    ...jobs.map((job) => ({ date: localDateOf(job.scheduledFor, timeZone), platform: job.draftPlatform, topic: job.draftTopic })),
  ].slice(0, ALREADY_PLANNED_SHOWN);
  return {
    dates,
    targets: planTargets(plan.cadence),
    pillars: plan.pillars.map((pillar) => ({ name: pillar.name, description: pillar.description, exampleTopics: pillar.example_topics })),
    campaigns: plan.campaigns.map((campaign) => ({
      name: campaign.name,
      objective: campaign.objective,
      pillar: campaign.pillar,
      platforms: campaign.platforms,
      timing: campaign.timing,
    })),
    alreadyPlanned,
  };
}

// Why nothing was planned, in plain words: never a server setting or an
// error's text (the log line has the class).
function describeNoPlan(result: ModelResult, posts: unknown[] | null): string {
  if (result.kind === "unavailable") {
    return "The AI isn't available right now, so nothing was planned. Try again later, or start drafts yourself in the studio.";
  }
  if (result.kind === "ok") {
    return posts === null
      ? "The AI's plan came back in a form that can't be used, so nothing was added. Try again."
      : "The AI's plan held no post that fits your plan's platforms and these days, so nothing was added. Try again.";
  }
  return "The AI couldn't plan the calendar just now, so nothing was added. Try again in a few minutes.";
}

function refused(message: string): CalendarPlanResult {
  return { ok: false, errors: { message } };
}
