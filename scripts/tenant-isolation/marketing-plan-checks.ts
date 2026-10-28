// Marketing plan checks (step 37): one company's plans, versions and
// support-trends setting never reach another (services and /db); members
// read the strategy but can't make a plan or change the setting, and an
// owner made a member meanwhile is refused; versions are numbered 1, 2,
// 3, ... per company, also for plans saved at the same moment; the hourly
// limit per company; and the setting itself. A FAKE model only: nothing
// calls Anthropic.

import assert from "node:assert/strict";
import { db } from "@/db/client";
import { getSupportTrendsSetting, setSupportTrendsSetting } from "@/db/cofounder-settings";
import { getMarketingPlanVersion, listMarketingPlanVersions, saveMarketingPlan, type NewMarketingPlan } from "@/db/marketing-plans";
import { marketingPlans } from "@/db/schema";
import { readMarketingPlanAnswer } from "@/lib/marketing-plan/plan-answer";
import { makeMarketingPlanForSession } from "@/services/marketing-plan";
import { getPlanVersionForSession, getStrategyPageForSession, setSupportTrendsForSession } from "@/services/marketing-strategy";
import { isOverRateLimit, RATE_LIMITS } from "@/services/rate-limit";
import { changeTeammateRoleForSession } from "@/services/team";
import { messageOf, scriptedModel } from "./cofounder-helpers";
import { addTeammate, assertRefusedByConstraint, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { makePlan, makeReadyForPlan, makeWorkingPlan, planAnswer, planRows } from "./marketing-plan-helpers";

// A plan as /db saves it, straight from a stand-in answer.
function newPlanRow(goalNote: string | null = null): NewMarketingPlan {
  const plan = readMarketingPlanAnswer(planAnswer(), new Set(["description"]));
  assert.ok(plan, "the stand-in plan is not a usable plan");
  return { goalNote, plan, factsUsed: [], knowledgeUsed: [], usedSupportTrends: false, performanceReviewId: null };
}

export async function runMarketingPlanChecks() {
  await check("marketing plan: another company can't read a company's plans, versions or setting, and each company numbers its own versions (services and /db)", async () => {
    const ownerA = sessionFor(await signUpTestOwner("plan-a"));
    const ownerB = sessionFor(await signUpTestOwner("plan-b"));
    await makeReadyForPlan(ownerA);
    await makeReadyForPlan(ownerB);
    await makeWorkingPlan(ownerA, `Plan A1 ${runId}`);
    await makeWorkingPlan(ownerA, `Plan A2 ${runId}`, planAnswer({ summary: `Summary of A ${runId}` }));
    assert.equal(await makeWorkingPlan(ownerB, `Plan B1 ${runId}`), 1);
    assert.deepEqual(await setSupportTrendsForSession(ownerA, { useSupportTrends: "on" }), { ok: true });

    const pageB = await getStrategyPageForSession(ownerB);
    assert.deepEqual(
      [pageB.newestVersion, pageB.versions.map((version) => version.version), pageB.current?.goalNote, pageB.usesSupportTrends],
      [1, [1], `Plan B1 ${runId}`, false],
    );
    assert.ok(!JSON.stringify(pageB).includes(`of A ${runId}`) && !JSON.stringify(pageB).includes(`Plan A`), "company B's page shows A's plan");
    assert.equal(await getPlanVersionForSession(ownerB, "2"), null);
    assert.equal((await getPlanVersionForSession(ownerB, "1"))?.plan.goalNote, `Plan B1 ${runId}`);
    assert.equal((await getPlanVersionForSession(ownerA, "2"))?.plan.content?.summary, `Summary of A ${runId}`);
    // /db: every read has the company in its WHERE.
    assert.equal(await getMarketingPlanVersion(ownerB.companyId, 2), undefined);
    assert.deepEqual((await listMarketingPlanVersions(ownerB.companyId, 50)).map((version) => version.version), [1]);
    assert.deepEqual([await getSupportTrendsSetting(ownerA.companyId), await getSupportTrendsSetting(ownerB.companyId)], [true, false]);
    // B turning its own setting on and off leaves A's alone.
    await setSupportTrendsForSession(ownerB, { useSupportTrends: "on" });
    await setSupportTrendsForSession(ownerB, { useSupportTrends: null });
    assert.deepEqual([await getSupportTrendsSetting(ownerA.companyId), await getSupportTrendsSetting(ownerB.companyId)], [true, false]);

    // /db never saves a plan for a company its maker isn't in, and Postgres
    // refuses one made by someone from another company.
    assert.deepEqual(await saveMarketingPlan(ownerA.companyId, ownerB.userId, newPlanRow()), { outcome: "not-allowed" });
    const row = { ...newPlanRow(), companyId: ownerA.companyId, version: 99, createdByUserId: ownerB.userId };
    await assertRefusedByConstraint(db.insert(marketingPlans).values(row), "marketing_plans_creator_in_same_company_fk");
    assert.deepEqual((await planRows(ownerA.companyId)).map((plan) => plan.version), [1, 2]);
  });

  await check("marketing plan: members read the strategy but can't make a plan or change the setting (services and /db); an owner made a member meanwhile is refused", async () => {
    const ownerUser = await signUpTestOwner("plan-roles");
    const owner = sessionFor(ownerUser);
    const member = sessionFor(await addTeammate(ownerUser, "plan-member", "member"));
    await makeReadyForPlan(owner);
    const model = scriptedModel([planAnswer()]);
    assert.match(messageOf(await makeMarketingPlanForSession(member, { goalNote: "" }, model.ask)), /Only owners can make a marketing plan/);
    assert.equal(model.requests.length, 0, "Claude was asked for a member");
    assert.match(messageOf(await setSupportTrendsForSession(member, { useSupportTrends: "on" })), /Only owners/);
    assert.equal(await setSupportTrendsSetting(member.companyId, member.userId, true), "not-allowed");
    assert.deepEqual(await saveMarketingPlan(member.companyId, member.userId, newPlanRow()), { outcome: "not-allowed" });
    assert.deepEqual([await planRows(owner.companyId), await getSupportTrendsSetting(owner.companyId)], [[], false]);

    // Members read exactly what owners read.
    await makeWorkingPlan(owner, "Weekday lunches");
    assert.equal(JSON.stringify(await getStrategyPageForSession(member)), JSON.stringify(await getStrategyPageForSession(owner)));
    assert.equal((await getPlanVersionForSession(member, "1"))?.plan.goalNote, "Weekday lunches");

    const demotedUser = await addTeammate(ownerUser, "plan-demoted", "owner");
    assert.deepEqual(await changeTeammateRoleForSession(owner, { userId: demotedUser.id, role: "member" }), { ok: true });
    // The session still says "owner", as one read just before the change would.
    const staleSession = sessionFor(demotedUser);
    assert.match(messageOf(await makeMarketingPlanForSession(staleSession, { goalNote: "" }, scriptedModel([planAnswer()]).ask)), /Only owners/);
    assert.match(messageOf(await setSupportTrendsForSession(staleSession, { useSupportTrends: "on" })), /Only owners/);
    assert.deepEqual([(await planRows(owner.companyId)).length, await getSupportTrendsSetting(owner.companyId)], [1, false]);
  });

  await check("marketing plan: versions are numbered 1, 2, 3, ... per company, also for plans saved at the same moment, each with its own note", async () => {
    const owner = sessionFor(await signUpTestOwner("plan-versions"));
    await makeReadyForPlan(owner);
    // Five requests at once, through the whole service.
    const attempts = await Promise.all(Array.from({ length: 5 }, (_, index) => makePlan(owner, `Plan ${index}`)));
    const versionByNote = new Map<string, number>();
    for (const [index, { result }] of attempts.entries()) {
      assert.ok(result.ok, messageOf(result));
      versionByNote.set(`Plan ${index}`, result.version);
    }
    // Five more saved by /db at once, with no Claude call between them.
    const saves = await Promise.all(Array.from({ length: 5 }, (_, index) => saveMarketingPlan(owner.companyId, owner.userId, newPlanRow(`Saved ${index}`))));
    for (const [index, saved] of saves.entries()) {
      assert.equal(saved.outcome, "saved");
      versionByNote.set(`Saved ${index}`, saved.outcome === "saved" ? saved.version : 0);
    }
    const rows = await planRows(owner.companyId);
    assert.deepEqual(rows.map((row) => row.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const row of rows) {
      assert.equal(versionByNote.get(row.goalNote ?? ""), row.version, `${row.goalNote} was saved as another version`);
    }
    // The database refuses a version the company already has.
    const duplicate = { ...newPlanRow(), companyId: owner.companyId, version: 3, createdByUserId: owner.userId };
    await assertRefusedByConstraint(db.insert(marketingPlans).values(duplicate), "marketing_plans_company_id_version_unique");
    const page = await getStrategyPageForSession(owner);
    assert.deepEqual([page.newestVersion, page.current?.version, page.versions.length, page.versions[0].version], [10, 10, 10, 10]);
  });

  await check("marketing plan: the hourly limit per company refuses before Claude is asked, for every owner; another company still plans", async () => {
    const ownerUser = await signUpTestOwner("plan-limit");
    const owner = sessionFor(ownerUser);
    const otherOwner = sessionFor(await addTeammate(ownerUser, "plan-limit-owner", "owner"));
    const elsewhere = sessionFor(await signUpTestOwner("plan-limit-elsewhere"));
    await makeReadyForPlan(owner);
    await makeReadyForPlan(elsewhere);
    for (let attempt = 0; attempt < RATE_LIMITS.marketingPlansPerCompany.maxAttempts; attempt++) {
      await isOverRateLimit("marketing-plans", owner.companyId, RATE_LIMITS.marketingPlansPerCompany);
    }
    for (const session of [owner, otherOwner]) {
      const { result, model } = await makePlan(session);
      assert.match(messageOf(result), /a lot of plans this hour/);
      assert.equal(model.requests.length, 0, "Claude was asked over the limit");
    }
    assert.deepEqual(await planRows(owner.companyId), []);
    assert.equal(await makeWorkingPlan(elsewhere), 1);
  });

  await check("marketing plan: the support-trends setting is off by default; owners turn it on and off; an odd value or too many changes are refused", async () => {
    const owner = sessionFor(await signUpTestOwner("plan-setting"));
    assert.equal((await getStrategyPageForSession(owner)).usesSupportTrends, false);
    assert.deepEqual(await setSupportTrendsForSession(owner, { useSupportTrends: "on" }), { ok: true });
    assert.equal((await getStrategyPageForSession(owner)).usesSupportTrends, true);
    // Saving the same choice again changes nothing, and still works.
    assert.equal(await setSupportTrendsSetting(owner.companyId, owner.userId, true), "unchanged");
    assert.deepEqual(await setSupportTrendsForSession(owner, { useSupportTrends: "on" }), { ok: true });
    // An unticked box sends nothing.
    assert.deepEqual(await setSupportTrendsForSession(owner, { useSupportTrends: null }), { ok: true });
    assert.equal(await getSupportTrendsSetting(owner.companyId), false);
    assert.match(messageOf(await setSupportTrendsForSession(owner, { useSupportTrends: "yes" })), /could not be read/);
    for (let attempt = 0; attempt < RATE_LIMITS.settingsChangesPerUser.maxAttempts; attempt++) {
      await isOverRateLimit("settings-changes", owner.userId, RATE_LIMITS.settingsChangesPerUser);
    }
    assert.match(messageOf(await setSupportTrendsForSession(owner, { useSupportTrends: "on" })), /Too many changes/);
    assert.equal(await getSupportTrendsSetting(owner.companyId), false);
  });
}
