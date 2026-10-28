// Calendar checks (step 41), "Plan the next 2 weeks": nothing is asked
// without a current marketing plan, of a member, past the hourly limit or
// without the browser's timezone; the AI's ideas become drafts in status
// idea (topic only) planned for their day and time in the owner's own
// timezone, nothing written, approved or scheduled; its answer is kept to
// what was asked, post by post; Claude gets only the plan's pillars,
// campaigns and cadence, the days and what is planned, escaped. A stand-in
// for Claude only.

import assert from "node:assert/strict";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { savePlannedIdeas } from "@/db/content-calendar";
import { contentDrafts } from "@/db/schema";
import { calendarPlanAnswerSchema, readCalendarPlanAnswer } from "@/lib/calendar-plan/plan-answer";
import { buildCalendarPlanJsonSchema } from "@/lib/calendar-plan/plan-json-schema";
import { planTargets } from "@/lib/calendar-plan/plan-prompt";
import { contentFormats } from "@/lib/content-studio/formats";
import { socialPlatforms } from "@/lib/social-platforms";
import { planNextTwoWeeksForSession } from "@/services/calendar-planning";
import { isOverRateLimit, RATE_LIMITS } from "@/services/rate-limit";
import { messageOf, modelAnswer, scriptedModel } from "./cofounder-helpers";
import { makeReadyForDrafts } from "./content-studio-helpers";
import { addTeammate, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { makeWorkingPlan, planAnswer, planAnswerJson } from "./marketing-plan-helpers";
import { activityRows } from "./publishing-helpers";

// 20:00 UTC on 3 November 2026 is already 4 November in Tokyo: the plan's
// days are the 5th to the 18th there.
const NOW = new Date("2026-11-03T20:00:00.000Z");
const TOKYO = { timeZone: "Asia/Tokyo" };

// One planned post as Claude writes it; `overrides` replaces whole fields.
function post(overrides: Record<string, unknown> = {}) {
  return { date: "2026-11-05", time: "09:30", platform: "facebook", format: "post", pillar: "Lunch ideas", campaign: "", topic: `Soup of the day ${runId}`, ...overrides };
}

async function ideasOf(companyId: string) {
  return db.select().from(contentDrafts).where(eq(contentDrafts.companyId, companyId)).orderBy(asc(contentDrafts.plannedFor), asc(contentDrafts.topic));
}

async function plannedOwner(label: string) {
  const ownerUser = await signUpTestOwner(label);
  const owner = sessionFor(ownerUser);
  await makeReadyForDrafts(owner);
  return { ownerUser, owner };
}

export async function runCalendarPlanChecks() {
  await check("calendar plan: without a current marketing plan it says so and asks nobody; a member is refused (the service and /db); a browser that names no timezone is refused; past its plans for the hour the company is refused before Claude is asked", async () => {
    const { ownerUser, owner } = await plannedOwner("plan-refusals");
    const model = scriptedModel([modelAnswer({ posts: [post()] })]);
    assert.match(messageOf(await planNextTwoWeeksForSession(owner, TOKYO, model.ask, NOW)), /no marketing plan yet/);
    await makeWorkingPlan(owner);
    const member = sessionFor(await addTeammate(ownerUser, "plan-refusals-member", "member"));
    assert.match(messageOf(await planNextTwoWeeksForSession(member, TOKYO, model.ask, NOW)), /Only owners plan the calendar/);
    const memberIdea = { platform: "facebook" as const, format: "post" as const, topic: `A member's idea ${runId}`, pillar: "", campaign: "", plannedFor: NOW };
    assert.deepEqual(await savePlannedIdeas(member.companyId, member.userId, [memberIdea]), { outcome: "not-allowed" });
    assert.match(messageOf(await planNextTwoWeeksForSession(owner, { timeZone: "Mars/Olympus" }, model.ask, NOW)), /didn't say its timezone/);
    for (let attempt = 0; attempt < RATE_LIMITS.calendarPlansPerCompany.maxAttempts; attempt++) {
      await isOverRateLimit("calendar-plans", owner.companyId, RATE_LIMITS.calendarPlansPerCompany);
    }
    assert.match(messageOf(await planNextTwoWeeksForSession(owner, TOKYO, model.ask, NOW)), /a lot this hour/);
    assert.deepEqual([model.requests.length, (await ideasOf(owner.companyId)).length], [0, 0]);
  });

  await check("calendar plan: the AI's ideas become drafts in status idea with only a topic, platform, format, pillar and campaign, planned for their day and time in the owner's own timezone; nothing written, approved or scheduled; each in the activity log", async () => {
    const { owner } = await plannedOwner("plan-ideas");
    await makeWorkingPlan(owner);
    const answer = modelAnswer({ posts: [post(), post({ date: "2026-11-07", time: "12:15", topic: `Lunch week starts ${runId}`, campaign: "lunch week" })] });
    const result = await planNextTwoWeeksForSession(owner, TOKYO, scriptedModel([answer]).ask, NOW);
    assert.deepEqual(result, { ok: true, added: 2 });
    const ideas = await ideasOf(owner.companyId);
    assert.deepEqual(
      ideas.map((idea) => [idea.status, idea.platform, idea.format, idea.pillar, idea.campaign, idea.topic, idea.plannedFor?.toISOString(), idea.body, idea.approvedByUserId]),
      [
        ["idea", "facebook", "post", "Lunch ideas", "", `Soup of the day ${runId}`, "2026-11-05T00:30:00.000Z", "", null],
        ["idea", "facebook", "post", "Lunch ideas", "Lunch week", `Lunch week starts ${runId}`, "2026-11-07T03:15:00.000Z", "", null],
      ],
    );
    const logged = (await activityRows(owner.companyId)).filter((entry) => entry.action === "idea_planned");
    assert.deepEqual(logged.map((entry) => [entry.draftId, entry.actorUserId]).sort(), ideas.map((idea) => [idea.id, owner.userId]).sort());
  });

  await check("calendar plan: the answer is kept to what was asked, post by post: a day not planned, a platform without a target, an empty topic and a repeat (also of one planned already) drop; an odd time is 09:00; a format the platform doesn't take is its first; a name not in the plan is none; never more than a platform's target; a field we didn't ask for makes it unusable", async () => {
    const targets = planTargets([{ platform: "facebook", posts_per_week: 1 }, { platform: "youtube", posts_per_week: 0.5 }]);
    assert.deepEqual(targets.map((target) => [target.platform, target.posts, [...target.formats]]), [["facebook", 2, ["post", "image_post"]], ["youtube", 1, ["video"]]]);
    const context = { dates: ["2026-11-05", "2026-11-06"], targets, pillars: ["Lunch ideas"], campaigns: [], plannedTopics: ["Planned already"] };
    const posts = [
      post({ date: "2026-12-25" }),
      post({ platform: "x" }),
      post({ topic: "   " }),
      post({ topic: "Planned already" }),
      post({ topic: "First", time: "25:99", pillar: "LUNCH IDEAS" }),
      post({ topic: "first", date: "2026-11-06" }),
      post({ topic: "A video", platform: "youtube", format: "post", pillar: "Made up", campaign: "Made up too" }),
      post({ topic: "Second" }),
      post({ topic: "Third, past the target" }),
    ];
    const kept = readCalendarPlanAnswer(modelAnswer({ posts }), context);
    assert.deepEqual(
      kept?.map((idea) => [idea.topic, idea.platform, idea.format, idea.time, idea.pillar, idea.campaign]),
      [
        ["First", "facebook", "post", "09:00", "Lunch ideas", ""],
        ["A video", "youtube", "video", "09:30", "", ""],
        ["Second", "facebook", "post", "09:30", "Lunch ideas", ""],
      ],
    );
    assert.equal(readCalendarPlanAnswer(modelAnswer({ posts: [{ ...post(), approved: true }] }), context), null);
    assert.equal(readCalendarPlanAnswer(modelAnswer({ posts: [post()], company_id: "x" }), context), null);
    assert.equal(readCalendarPlanAnswer({ kind: "unavailable" }, context), null);
    const { owner } = await plannedOwner("plan-unusable");
    await makeWorkingPlan(owner);
    const unusable = await planNextTwoWeeksForSession(owner, TOKYO, scriptedModel([modelAnswer({ posts: [{ ...post(), status: "approved" }] })]).ask, NOW);
    assert.match(messageOf(unusable), /can't be used, so nothing was added/);
    const nothingFits = await planNextTwoWeeksForSession(owner, TOKYO, scriptedModel([modelAnswer({ posts: [post({ platform: "x" })] })]).ask, NOW);
    assert.match(messageOf(nothingFits), /held no post that fits/);
    assert.equal((await ideasOf(owner.companyId)).length, 0);
  });

  await check("calendar plan: Claude gets only the plan's pillars, campaigns and cadence, the days and the topics planned then, each escaped (card numbers hidden); no fact, account or id; the schema sent and our own check agree", async () => {
    const { owner } = await plannedOwner("plan-prompt");
    const pillars = [
      { name: "Lunch <b>ideas</b>", description: "Card 4111 1111 1111 1111 for the soup.", example_topics: ["Soup of the day"] },
      ...(planAnswerJson().pillars as unknown[]).slice(1),
    ];
    await makeWorkingPlan(owner, "", planAnswer({ pillars }));
    const model = scriptedModel([modelAnswer({ posts: [post({ pillar: "Lunch <b>ideas</b>" })] })]);
    assert.deepEqual(await planNextTwoWeeksForSession(owner, TOKYO, model.ask, NOW), { ok: true, added: 1 });
    const [request] = model.requests;
    assert.match(request.prompt, /<pillar name="Lunch &lt;b&gt;ideas&lt;\/b&gt;">Card \[number\] for the soup\./);
    assert.match(request.prompt, /<target platform="facebook" name="Facebook" posts="6" formats="post \(Text post\), image_post \(Post with an image\)"\/>/);
    assert.match(request.prompt, /<date weekday="Thursday">2026-11-05<\/date>/);
    assert.match(request.prompt, /<date weekday="Wednesday">2026-11-18<\/date>/);
    assert.doesNotMatch(request.prompt, /2026-11-04|2026-11-19/);
    for (const forbidden of ["Bluebird", "Lisbon", "Office workers", owner.companyId, owner.userId, owner.email, "4111"]) {
      assert.ok(!request.prompt.includes(forbidden) && !request.systemPrompt.includes(forbidden), `the request holds ${forbidden}`);
    }
    // A second plan names the first one's idea as planned already.
    const again = scriptedModel([modelAnswer({ posts: [] })]);
    await planNextTwoWeeksForSession(owner, TOKYO, again.ask, NOW);
    assert.match(again.requests[0].prompt, /<already_planned>\n<post date="2026-11-05" platform="facebook">Soup of the day/);
    const schema = buildCalendarPlanJsonSchema();
    const postSchema = (schema.properties.posts as { items: { properties: Record<string, { enum?: string[] }>; required: string[]; additionalProperties: boolean } }).items;
    assert.deepEqual([Object.keys(postSchema.properties).sort(), postSchema.required.sort(), postSchema.additionalProperties], [Object.keys(calendarPlanAnswerSchema.shape.posts.element.shape).sort(), Object.keys(calendarPlanAnswerSchema.shape.posts.element.shape).sort(), false]);
    assert.deepEqual([postSchema.properties.platform.enum, postSchema.properties.format.enum], [[...socialPlatforms], [...contentFormats]]);
    assert.deepEqual([schema.required, schema.additionalProperties], [["posts"], false]);
  });
}
