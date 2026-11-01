// "Post for me" checks (step 54), every one with a fake model: when posts
// are due, what ansa's brain picks (the mix, special days, no repeats, more
// of what people liked), the checks that stop a made-up price or offer,
// and the whole run: switched on only with the owner's tick, written once
// per posting time, scheduled under the owner's rule (or waiting in Ask me
// first), sent now on "Post one now", taken back when switched off.

import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { assistantSettings, autopublishRules, autopostSlots, contentDrafts, publishJobs } from "@/db/schema";
import { chooseNextPost, type PastPost } from "@/lib/autopost/brain";
import { checkAutopostText } from "@/lib/autopost/checks";
import { nextPostingTimes, postingTimeToWrite } from "@/lib/autopost/schedule";
import { getAutopostPageForSession, postNowForSession, saveAutopostForSession } from "@/services/autopost";
import { runDuePosts } from "@/services/autopost-runs";
import { saveAuthorizedAccounts } from "@/services/social-account-saving";
import { fakeModel, setUpRestaurant } from "./assistant-check-helpers";
import { addTeammate, check, runId, sessionFor, signUpTestOwner, type TestUser } from "./helpers";

const CHECK_DATA = { currency: "EUR", menuPrices: [950], ownerTexts: ["Lunch menu every weekday."], wordsToAvoid: ["cheap"] };

function post(body: string, extra: { callToAction?: string; hashtags?: string[] } = {}) {
  return JSON.stringify({ body, call_to_action: extra.callToAction ?? "", hashtags: extra.hashtags ?? [] });
}

async function readyToPost(owner: TestUser): Promise<void> {
  await setUpRestaurant(owner);
  const page = {
    externalAccountId: String(Date.now()).slice(-12) + String(Math.floor(Math.random() * 1000)),
    displayName: `Page ${runId}`,
    accountKind: "page" as const,
    scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
    accessToken: "page-token",
    refreshToken: null,
    accessExpiresAt: null,
    refreshExpiresAt: null,
  };
  assert.equal(await saveAuthorizedAccounts(owner.companyId, owner.id, "facebook", [page], false), "saved");
  await db.update(assistantSettings).set({ timeZone: "Europe/Rome" }).where(eq(assistantSettings.companyId, owner.companyId));
}

async function slotsOf(owner: TestUser) {
  return db
    .select({ status: autopostSlots.status, kind: autopostSlots.kind, draftId: autopostSlots.draftId, reason: autopostSlots.skipReason, postAt: autopostSlots.postAt })
    .from(autopostSlots)
    .where(eq(autopostSlots.companyId, owner.companyId));
}

export async function runAutopostChecks() {
  await check("post for me: posting times fall on the chosen days at the business's own local time, and a post is written only within a day of its time", async () => {
    const sunday = new Date("2026-11-01T12:00:00Z");
    const times = nextPostingTimes("three_a_week", "11:00", "Asia/Dhaka", sunday, 3).map((time) => time.toISOString());
    assert.deepEqual(times, ["2026-11-02T05:00:00.000Z", "2026-11-04T05:00:00.000Z", "2026-11-06T05:00:00.000Z"]);
    assert.deepEqual(nextPostingTimes("weekly", "18:30", "Europe/Rome", sunday, 1).map((time) => time.toISOString()), ["2026-11-06T17:30:00.000Z"]);
    assert.equal(postingTimeToWrite("weekly", "18:30", "Europe/Rome", sunday), null);
    assert.equal(postingTimeToWrite("daily", "11:00", "Asia/Dhaka", sunday)?.toISOString(), "2026-11-02T05:00:00.000Z");
  });

  await check("post for me: ansa's brain picks a special day once, spotlights each dish in turn, leaves out a kind that just failed, and does more of what people liked", async () => {
    const base = { kind: "business" as const, businessType: "restaurant" as const, items: ["Margherita", "Tiramisù"], date: "2026-11-04", weekday: "Wednesday", history: [] as PastPost[] };
    assert.deepEqual(chooseNextPost(base), { kind: "spotlight", itemName: "Margherita", specialDay: "", topic: "Margherita" });
    // Variety first: a dish spotlighted in one of the last three posts makes room for another kind.
    const recent = chooseNextPost({ ...base, history: [{ kind: "spotlight", itemName: "Margherita", specialDay: "", engagement: 3 }] });
    assert.notEqual(recent.kind, "spotlight");
    const older: PastPost[] = [
      { kind: "tip", itemName: "", specialDay: "", engagement: null },
      { kind: "question", itemName: "", specialDay: "", engagement: null },
      { kind: "behind_the_scenes", itemName: "", specialDay: "", engagement: null },
      { kind: "spotlight", itemName: "Margherita", specialDay: "", engagement: 3 },
    ];
    const afterMargherita = chooseNextPost({ ...base, history: older });
    assert.deepEqual([afterMargherita.kind, afterMargherita.itemName], ["spotlight", "Tiramisù"]);
    assert.equal(chooseNextPost({ ...base, date: "2026-12-24" }).kind, "special_day");
    assert.notEqual(chooseNextPost({ ...base, date: "2026-12-24", history: [{ kind: "special_day", itemName: "", specialDay: "Christmas Eve", engagement: 9 }] }).kind, "special_day");
    assert.notEqual(chooseNextPost({ ...base, skip: ["spotlight"] }).kind, "spotlight");
    // Behind-the-scenes posts got four times the reactions of spotlights.
    const liked: PastPost[] = [
      ...Array.from({ length: 3 }, () => ({ kind: "tip" as const, itemName: "", specialDay: "", engagement: null })),
      { kind: "behind_the_scenes", itemName: "", specialDay: "", engagement: 40 },
      { kind: "spotlight", itemName: "Margherita", specialDay: "", engagement: 10 },
      { kind: "spotlight", itemName: "Tiramisù", specialDay: "", engagement: 10 },
    ];
    assert.equal(chooseNextPost({ ...base, history: liked }).kind, "behind_the_scenes");
    // A shop has no dishes to spotlight but its products; with none listed, no spotlight.
    assert.notEqual(chooseNextPost({ ...base, businessType: "shop", items: [] }).kind, "spotlight");
  });

  await check("post for me: a post with a price that isn't the business's, a percentage or a discount it never offered, a link, or a word to avoid is stopped; one using its own price passes", async () => {
    const ok = (body: string) => checkAutopostText({ body, callToAction: "", hashtags: [] }, CHECK_DATA);
    assert.equal(ok("Our Margherita is back: €9.50 of pure joy. See you tonight!"), true);
    assert.equal(ok("Margherita for only €5 tonight!"), false);
    assert.equal(ok("20% off all pizzas this week!"), false);
    assert.equal(ok("A special discount for you this week."), false);
    assert.equal(ok("Book at https://example.com/book now."), false);
    assert.equal(ok("Good food, never cheap in taste."), false);
  });

  await check("post for me: only an owner switches it on, and Automatic needs their tick; it then writes each posting time's post once, schedules it under the owner's Facebook rule, and stops a made-up offer twice before skipping", async () => {
    const owner = await signUpTestOwner("autopost-owner");
    const member = await addTeammate(owner, "autopost-member", "member");
    const choices = { enabled: "on", frequency: "daily", time: "11:00", mode: "automatic" };
    assert.equal((await saveAutopostForSession(sessionFor(member), { ...choices, understood: "on" })).ok, false);
    await setUpRestaurant(owner);
    assert.match(JSON.stringify(await saveAutopostForSession(sessionFor(owner), { ...choices, understood: "on" })), /time zone/);
    await readyToPost(owner);
    assert.match(JSON.stringify(await saveAutopostForSession(sessionFor(owner), choices)), /Tick this/);
    assert.deepEqual(await saveAutopostForSession(sessionFor(owner), { ...choices, understood: "on" }), { ok: true });
    const [rule] = await db.select().from(autopublishRules).where(and(eq(autopublishRules.companyId, owner.companyId), eq(autopublishRules.platform, "facebook")));
    assert.deepEqual([rule.pillar, rule.enabled, rule.enabledByUserId], ["", true, owner.id]);

    const model = fakeModel(post("Fresh out of the oven: our Margherita, €9.50. See you tonight!", { callToAction: "Come by tonight", hashtags: ["#pizza", "napoli"] }));
    assert.equal(await runDuePosts(Date.now(), { asker: model.asker }, owner.companyId), 1);
    assert.equal(await runDuePosts(Date.now(), { asker: model.asker }, owner.companyId), 0, "one post per posting time");
    const [slot] = await slotsOf(owner);
    assert.equal(slot.status, "scheduled");
    const [draft] = await db.select().from(contentDrafts).where(eq(contentDrafts.id, slot.draftId ?? ""));
    assert.deepEqual([draft.platform, draft.format, draft.status, draft.hashtags], ["facebook", "post", "scheduled", ["pizza", "napoli"]]);
    const [job] = await db.select().from(publishJobs).where(eq(publishJobs.draftId, draft.id));
    assert.deepEqual([job.status, job.approvalMode, job.scheduledFor.toISOString()], ["queued", "auto_rule", slot.postAt.toISOString()]);
    assert.ok(model.requests[0].prompt.includes("Margherita | €9.50") && !model.requests[0].prompt.includes(owner.email));

    // "Post one now": a made-up offer, twice: skipped, nothing posted.
    const made = await postNowForSession(sessionFor(owner), { asker: fakeModel(post("50% discount on everything today!")).asker });
    assert.equal(made.ok, false);
    assert.ok((await slotsOf(owner)).some((row) => row.status === "skipped" && row.reason === "checks_failed"));
    const now = await postNowForSession(sessionFor(owner), { asker: model.asker });
    assert.equal(now.ok && now.jobIds?.length, 1);

    // Another company sees none of it.
    const stranger = await signUpTestOwner("autopost-stranger");
    assert.equal((await getAutopostPageForSession(sessionFor(stranger))).slots.length, 0);
  });

  await check("post for me: in Ask me first a post waits for an owner's approval (no post in the queue); switched off, the rule goes off and the posts not out yet are taken back", async () => {
    const owner = await signUpTestOwner("autopost-ask");
    await readyToPost(owner);
    assert.deepEqual(await saveAutopostForSession(sessionFor(owner), { enabled: "on", frequency: "daily", time: "11:00", mode: "ask_first" }), { ok: true });
    const model = fakeModel(post("Tiramisù, made this morning. €6.00 a slice."));
    assert.equal(await runDuePosts(Date.now(), { asker: model.asker }, owner.companyId), 1);
    const [waiting] = await slotsOf(owner);
    assert.equal(waiting.status, "waiting_approval");
    assert.equal((await db.select().from(publishJobs).where(eq(publishJobs.companyId, owner.companyId))).length, 0);

    assert.deepEqual(await saveAutopostForSession(sessionFor(owner), { enabled: "on", frequency: "daily", time: "11:00", mode: "automatic", understood: "on" }), { ok: true });
    assert.equal(await postNowForSession(sessionFor(owner), { asker: model.asker }).then((result) => result.ok), true);
    assert.deepEqual(await saveAutopostForSession(sessionFor(owner), { enabled: "off", frequency: "daily", time: "11:00", mode: "automatic" }), { ok: true });
    const [rule] = await db.select().from(autopublishRules).where(eq(autopublishRules.companyId, owner.companyId));
    assert.equal(rule.enabled, false);
    const after = await slotsOf(owner);
    assert.ok(after.length >= 2 && after.every((row) => row.status === "skipped" && row.reason === "stopped"));
    const queued = await db.select().from(publishJobs).where(and(eq(publishJobs.companyId, owner.companyId), eq(publishJobs.status, "queued")));
    assert.equal(queued.length, 0);
  });
}
