// Marketing plan page checks (step 37): the Strategy page shows the current
// plan with who made it and from what, every version, and says when the
// profile changed since; each version opens by its number, anything else
// is "not found"; a stored plan this code can't read shows as such; the
// owner's note is 0-1,000 characters, refused before Claude is asked when
// it isn't; and the database's CHECKs hold. A FAKE model only.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { marketingPlans } from "@/db/schema";
import { getPlanVersionForSession, getStrategyPageForSession } from "@/services/marketing-strategy";
import { typeFact } from "./cofounder-helpers";
import { assertRefusedByConstraint, check, sessionFor, signUpTestOwner } from "./helpers";
import { makePlan, makeReadyForPlan, makeWorkingPlan, planAnswerJson, planRows, READY_FACTS } from "./marketing-plan-helpers";

export async function runMarketingPlanPageChecks() {
  await check("marketing plan: the Strategy page shows the current plan, who made it and from what, every version, and says when the profile changed since", async () => {
    const owner = sessionFor(await signUpTestOwner("plan-page"));
    let page = await getStrategyPageForSession(owner);
    assert.deepEqual([page.current, page.newestVersion, page.versions], [null, 0, []]);
    await makeReadyForPlan(owner);
    await makeWorkingPlan(owner, "Weekday lunches");
    page = await getStrategyPageForSession(owner);
    const current = page.current;
    assert.ok(current, "no current plan");
    assert.deepEqual(
      [current.version, current.createdByName, current.goalNote, current.usedSupportTrends, current.profileChangedSince],
      [1, "Owner plan-page", "Weekday lunches", false, false],
    );
    assert.deepEqual(
      current.factsUsed.map((fact) => [fact.label, fact.value]),
      [
        ["What the business does", READY_FACTS.description],
        ["Products", READY_FACTS.products],
        ["Target customers", READY_FACTS.target_customers],
      ],
    );
    assert.equal(current.content?.summary, planAnswerJson().summary);
    // A confirmed fact added since: the plan no longer matches the profile.
    await typeFact(owner, "industry", "Bakery");
    assert.equal((await getStrategyPageForSession(owner)).current?.profileChangedSince, true);

    await makeWorkingPlan(owner);
    page = await getStrategyPageForSession(owner);
    assert.deepEqual([page.newestVersion, page.current?.version, page.current?.goalNote, page.current?.profileChangedSince], [2, 2, null, false]);
    assert.deepEqual(
      page.versions.map((version) => [version.version, version.createdByName, version.factCount]),
      [
        [2, "Owner plan-page", 4],
        [1, "Owner plan-page", 3],
      ],
    );
    // Each version opens by its number; anything else is "not found".
    const first = await getPlanVersionForSession(owner, "1");
    assert.deepEqual([first?.plan.version, first?.plan.goalNote, first?.newestVersion, first?.plan.profileChangedSince], [1, "Weekday lunches", 2, true]);
    for (const bad of ["3", "0", "-1", "1.5", "abc", "", " ", "99999999999", null, undefined]) {
      assert.equal(await getPlanVersionForSession(owner, bad), null, String(bad));
    }
    // A stored plan this code can't read is shown as such, with what it was made from.
    const versionOne = and(eq(marketingPlans.companyId, owner.companyId), eq(marketingPlans.version, 1));
    await db.update(marketingPlans).set({ plan: { summary: "An older shape" } }).where(versionOne);
    const unreadable = await getPlanVersionForSession(owner, "1");
    assert.deepEqual([unreadable?.plan.content, unreadable?.plan.factsUsed.length], [null, 3]);
  });

  await check("marketing plan: the note is 0-1,000 characters with a line break counting once; control characters are refused before Claude is asked; the database's CHECKs hold", async () => {
    const owner = sessionFor(await signUpTestOwner("plan-note"));
    await makeReadyForPlan(owner);
    for (const goalNote of ["x".repeat(1001), "Hidden \u0000 byte", "Bell \u0007 here"]) {
      const { result, model } = await makePlan(owner, goalNote);
      assert.ok(!result.ok && result.errors.fieldErrors?.goalNote, `accepted ${JSON.stringify(goalNote).slice(0, 40)}`);
      assert.equal(model.requests.length, 0, "Claude was asked");
    }
    // 1,000 characters with a browser's line break: it counts once, stored as \n.
    await makeWorkingPlan(owner, `${"a".repeat(499)}\r\n${"b".repeat(500)}`);
    // Blank, or not sent at all: no note.
    await makeWorkingPlan(owner, "  \n  ");
    const { result } = await makePlan(owner, null);
    assert.ok(result.ok);
    const rows = await planRows(owner.companyId);
    assert.deepEqual(rows.map((row) => row.goalNote), [`${"a".repeat(499)}\n${"b".repeat(500)}`, null, null]);

    const valid = { companyId: owner.companyId, plan: rows[0].plan, factsUsed: [], knowledgeUsed: [], usedSupportTrends: false, createdByUserId: owner.userId };
    await assertRefusedByConstraint(db.insert(marketingPlans).values({ ...valid, version: 0 }), "marketing_plans_version_positive");
    await assertRefusedByConstraint(db.insert(marketingPlans).values({ ...valid, version: 50, goalNote: "" }), "marketing_plans_goal_note_length");
    await assertRefusedByConstraint(db.insert(marketingPlans).values({ ...valid, version: 51, goalNote: "x".repeat(1001) }), "marketing_plans_goal_note_length");
    await assertRefusedByConstraint(db.insert(marketingPlans).values({ ...valid, version: 52, plan: [] }), "marketing_plans_plan_is_object");
    await assertRefusedByConstraint(db.insert(marketingPlans).values({ ...valid, version: 53, plan: { text: "x".repeat(200_001) } }), "marketing_plans_plan_size");
    await assertRefusedByConstraint(db.insert(marketingPlans).values({ ...valid, version: 54, factsUsed: {} }), "marketing_plans_facts_used_is_array");
    const elevenArticles = Array.from({ length: 11 }, () => randomUUID());
    await assertRefusedByConstraint(db.insert(marketingPlans).values({ ...valid, version: 55, knowledgeUsed: elevenArticles }), "marketing_plans_knowledge_used_count");
  });
}
