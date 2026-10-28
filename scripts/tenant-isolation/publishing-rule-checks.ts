// Auto-publish rule checks (step 41): rules are made switched off, by
// owners only, and only an owner's switch turns one on; without an approval
// a draft is scheduled only with the owner's tick, under an enabled rule
// covering its platform and pillar, when it breaks no rule and makes no
// claim an owner would have to check; a rule's post fails when it runs once
// an owner behind the rule left or a claim stopped being backed; approving
// a rule's draft whose post needs a check leaves its status to the queue.
// Through the real services and /db; fake platforms only.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { createAutopublishRule, setAutopublishRuleEnabled } from "@/db/autopublish-rules";
import { autopublishRules } from "@/db/schema";
import { createAutopublishRuleForSession, setAutopublishRuleForSession } from "@/services/autopublish-rules";
import { archiveDraftForSession, rejectDraftForSession } from "@/services/content-review";
import { markJobPublishedForSession } from "@/services/publish-job-actions";
import { changeTeammateRoleForSession } from "@/services/team";
import { messageOf, typeFact } from "./cofounder-helpers";
import { approveDraft, draftRow, editDraft, generatedDraftId, LINKEDIN_POST, makeReadyForDrafts } from "./content-studio-helpers";
import { addTeammate, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { makeWorkingPlan } from "./marketing-plan-helpers";
import { activityRows, cleanDraftAnswer, inMinutes, jobRow, jobRowsOfDraft, makeDue, realLinkedInAccount, runNow, schedule, throughFakePlatform } from "./publishing-helpers";
import { appSourceFiles, read, withoutComments } from "./source-helpers";
import { fakePlatform, noPlatform } from "./social-helpers";

async function rulesOf(companyId: string) {
  return db.select().from(autopublishRules).where(eq(autopublishRules.companyId, companyId));
}

export async function runPublishingRuleChecks() {
  await check("auto-publish rules: made switched off by owners only (a member is refused, services and /db); switching one on or off is an owner's, recorded with who and when; one rule per platform and pillar; a pillar must be the current plan's", async () => {
    const ownerUser = await signUpTestOwner("rule-make");
    const owner = sessionFor(ownerUser);
    await makeReadyForDrafts(owner);
    await makeWorkingPlan(owner);
    const member = sessionFor(await addTeammate(ownerUser, "rule-make-member", "member"));
    assert.match(messageOf(await createAutopublishRuleForSession(member, { platform: "linkedin", pillar: "" })), /Only owners/);
    assert.deepEqual(await createAutopublishRule(member.companyId, member.userId, { platform: "linkedin", pillar: "" }), { outcome: "not-allowed" });
    assert.match(JSON.stringify(await createAutopublishRuleForSession(owner, { platform: "linkedin", pillar: "Made up" })), /content pillar of the current marketing plan/);
    assert.deepEqual(await createAutopublishRuleForSession(owner, { platform: "linkedin", pillar: "lunch ideas" }), { ok: true });
    assert.match(messageOf(await createAutopublishRuleForSession(owner, { platform: "linkedin", pillar: "Lunch ideas" })), /already/);
    const [rule] = await rulesOf(owner.companyId);
    assert.deepEqual([rule.pillar, rule.enabled, rule.enabledByUserId, rule.enabledAt, rule.createdByUserId], ["Lunch ideas", false, null, null, owner.userId]);
    assert.match(messageOf(await setAutopublishRuleForSession(member, { ruleId: rule.id }, true)), /Only owners/);
    assert.equal(await setAutopublishRuleEnabled(member.companyId, member.userId, rule.id, true), "not-allowed");
    assert.equal((await rulesOf(owner.companyId))[0].enabled, false);
    assert.deepEqual(await setAutopublishRuleForSession(owner, { ruleId: rule.id }, true), { ok: true });
    const on = (await rulesOf(owner.companyId))[0];
    assert.ok(on.enabled && on.enabledByUserId === owner.userId && on.enabledAt, "not switched on by the owner");
    assert.deepEqual(await setAutopublishRuleForSession(owner, { ruleId: rule.id }, false), { ok: true });
    const off = (await rulesOf(owner.companyId))[0];
    assert.deepEqual([off.enabled, off.enabledByUserId, off.enabledAt], [false, null, null]);
    const logged = (await activityRows(owner.companyId)).filter((entry) => entry.ruleId === rule.id).map((entry) => `${entry.action}:${entry.actorUserId}`);
    assert.deepEqual(logged, [`rule_created:${owner.userId}`, `rule_enabled:${owner.userId}`, `rule_disabled:${owner.userId}`]);
  });

  await check("auto-publish rules: without an approval a draft is scheduled only with the owner's tick and an enabled rule covering its platform and pillar, when it breaks no rule and every claim is backed; a claim to check, a hand edit, a rejected or archived draft never go", async () => {
    const owner = sessionFor(await signUpTestOwner("rule-schedule"));
    await makeReadyForDrafts(owner);
    await makeWorkingPlan(owner);
    const account = await realLinkedInAccount(owner, `member${runId}rs`);
    const clean = await generatedDraftId(owner, { ...LINKEDIN_POST, topic: `Clean ${runId}`, pillar: "Lunch ideas" }, cleanDraftAnswer());
    assert.match(messageOf((await schedule(owner, clean, [account], inMinutes(60), { withoutApproval: true })).result), /No auto-publish rule that is switched on/);
    assert.deepEqual(await createAutopublishRuleForSession(owner, { platform: "linkedin", pillar: "Behind the oven" }), { ok: true });
    const [otherPillar] = await rulesOf(owner.companyId);
    assert.deepEqual(await setAutopublishRuleForSession(owner, { ruleId: otherPillar.id }, true), { ok: true });
    assert.match(messageOf((await schedule(owner, clean, [account], inMinutes(60), { withoutApproval: true })).result), /No auto-publish rule/, "a rule for another pillar covered it");
    assert.deepEqual(await createAutopublishRuleForSession(owner, { platform: "linkedin", pillar: "Lunch ideas" }), { ok: true });
    const lunch = (await rulesOf(owner.companyId)).find((rule) => rule.pillar === "Lunch ideas");
    assert.ok(lunch);
    assert.deepEqual(await setAutopublishRuleForSession(owner, { ruleId: lunch.id }, true), { ok: true });
    assert.match(messageOf((await schedule(owner, clean, [account], inMinutes(60))).result), /An owner approves this version/, "it went without the owner's tick");
    assert.deepEqual((await schedule(owner, clean, [account], inMinutes(60), { withoutApproval: true })).result, { ok: true });
    const [job] = await jobRowsOfDraft(clean);
    assert.deepEqual([job.approvalMode, job.autopublishRuleId, (await draftRow(clean)).status, (await draftRow(clean)).approvedByUserId], ["auto_rule", lunch.id, "scheduled", null]);
    const unbacked = await generatedDraftId(owner, { ...LINKEDIN_POST, topic: `Unbacked claim ${runId}`, pillar: "Lunch ideas" });
    assert.match(messageOf((await schedule(owner, unbacked, [account], inMinutes(60), { withoutApproval: true })).result), /isn't backed by a confirmed fact/);
    const edited = await generatedDraftId(owner, { ...LINKEDIN_POST, topic: `Edited by hand ${runId}`, pillar: "Lunch ideas" }, cleanDraftAnswer());
    assert.deepEqual(await editDraft(owner, edited, { body: "Typed by a person." }), { ok: true });
    assert.match(messageOf((await schedule(owner, edited, [account], inMinutes(60), { withoutApproval: true })).result), /changed by hand/);
    const rejected = await generatedDraftId(owner, { ...LINKEDIN_POST, topic: `Rejected ${runId}`, pillar: "Lunch ideas" }, cleanDraftAnswer());
    assert.deepEqual(await rejectDraftForSession(owner, { draftId: rejected, version: "1", note: null }), { ok: true });
    const archived = await generatedDraftId(owner, { ...LINKEDIN_POST, topic: `Archived ${runId}`, pillar: "Lunch ideas" }, cleanDraftAnswer());
    assert.deepEqual(await archiveDraftForSession(owner, { draftId: archived }), { ok: true });
    for (const draftId of [rejected, archived]) {
      assert.match(messageOf((await schedule(owner, draftId, [account], inMinutes(60), { withoutApproval: true })).result), /never published/);
    }
    assert.deepEqual([(await jobRowsOfDraft(unbacked)).length, (await jobRowsOfDraft(edited)).length, (await jobRowsOfDraft(rejected)).length], [0, 0, 0]);
  });

  await check("auto-publish rules: a rule's post fails when it runs once the owner who switched the rule on is no longer an owner (rule_owner_gone), or a confirmed fact behind its claim changed (claims_not_checked); nothing is sent, and the rule schedules nothing more while that owner is gone", async () => {
    const ownerUser = await signUpTestOwner("rule-run");
    const owner = sessionFor(ownerUser);
    await makeReadyForDrafts(owner);
    const account = await realLinkedInAccount(owner, `member${runId}rr`);
    const switcher = sessionFor(await addTeammate(ownerUser, "rule-run-switcher", "owner"));
    assert.deepEqual(await createAutopublishRuleForSession(owner, { platform: "linkedin", pillar: "" }), { ok: true });
    const [rule] = await rulesOf(owner.companyId);
    assert.deepEqual(await setAutopublishRuleForSession(switcher, { ruleId: rule.id }, true), { ok: true });
    const first = await generatedDraftId(owner, { ...LINKEDIN_POST, topic: `Switcher leaves ${runId}` }, cleanDraftAnswer());
    const second = await generatedDraftId(owner, { ...LINKEDIN_POST, topic: `Fact changes ${runId}` }, cleanDraftAnswer());
    for (const draftId of [first, second]) {
      assert.deepEqual((await schedule(owner, draftId, [account], inMinutes(60), { withoutApproval: true })).result, { ok: true });
    }
    const [firstJob] = await jobRowsOfDraft(first);
    const [secondJob] = await jobRowsOfDraft(second);
    await typeFact(owner, "description", "Bluebird Bakery now bakes in Porto.");
    await makeDue(secondJob.id);
    assert.equal(await runNow(owner, secondJob.id, throughFakePlatform(noPlatform)), "failed");
    assert.equal((await jobRow(secondJob.id)).lastError, "claims_not_checked");
    assert.deepEqual(await changeTeammateRoleForSession(owner, { userId: switcher.userId, role: "member" }), { ok: true });
    await makeDue(firstJob.id);
    assert.equal(await runNow(owner, firstJob.id, throughFakePlatform(noPlatform)), "failed");
    assert.equal((await jobRow(firstJob.id)).lastError, "rule_owner_gone");
    const third = await generatedDraftId(owner, { ...LINKEDIN_POST, topic: `After the switcher left ${runId}` }, cleanDraftAnswer());
    const refused = await schedule(owner, third, [account], inMinutes(60), { withoutApproval: true });
    assert.match(messageOf(refused.result), /An owner behind the auto-publish rule is no longer an owner/);
    assert.equal((await jobRowsOfDraft(third)).length, 0);
  });

  await check("auto-publish rules: approving a rule's draft whose post needs a check leaves its status to its posts: it stays a publishing problem, and once the post is marked published the draft is published (read-only), not left approved", async () => {
    const owner = sessionFor(await signUpTestOwner("rule-approve-later"));
    await makeReadyForDrafts(owner);
    const account = await realLinkedInAccount(owner, `member${runId}ral`);
    assert.deepEqual(await createAutopublishRuleForSession(owner, { platform: "linkedin", pillar: "" }), { ok: true });
    const [rule] = await rulesOf(owner.companyId);
    assert.deepEqual(await setAutopublishRuleForSession(owner, { ruleId: rule.id }, true), { ok: true });
    const draftId = await generatedDraftId(owner, { ...LINKEDIN_POST, topic: `Approved after a problem ${runId}` }, cleanDraftAnswer());
    const unclear = fakePlatform([new Response(null, { status: 500 })]);
    const sent = await schedule(owner, draftId, [account], "now", { withoutApproval: true, run: throughFakePlatform(unclear.fetchFn) });
    assert.deepEqual([sent.result, (await sent.after.settle())[0]], [{ ok: true }, ["needs_attention"]]);
    assert.deepEqual([(await draftRow(draftId)).status, (await draftRow(draftId)).approvedByUserId], ["failed", null]);
    assert.deepEqual(await approveDraft(owner, draftId, true), { ok: true });
    assert.deepEqual([(await draftRow(draftId)).status, (await draftRow(draftId)).approvedByUserId], ["failed", owner.userId]);
    const [job] = await jobRowsOfDraft(draftId);
    assert.deepEqual(await markJobPublishedForSession(owner, { jobId: job.id, postUrl: "" }), { ok: true });
    assert.equal((await draftRow(draftId)).status, "published");
    const version = (await draftRow(draftId)).version;
    assert.match(messageOf(await editDraft(owner, draftId, { body: "Changed after it went out." })), /status changed meanwhile/);
    assert.equal((await draftRow(draftId)).version, version, "a published draft's text changed");
  });

  await check("auto-publish rules: nothing turns a rule on by itself: a new rule is saved switched off, and the only write that sets enabled is an owner's switch (db/autopublish-rules.ts); no migration turns one on", async () => {
    const writers: string[] = [];
    for (const file of await appSourceFiles()) {
      const code = withoutComments(await read(file));
      if (/\.(update|insert)\(autopublishRules\)/.test(code)) {
        writers.push(file);
      }
    }
    assert.deepEqual(writers, ["db/autopublish-rules.ts"]);
    const rules = withoutComments(await read("db/autopublish-rules.ts"));
    assert.match(rules, /\.insert\(autopublishRules\)\s*\.values\(\{[^}]*enabled: false/);
    assert.equal((rules.match(/\.set\(\{ enabled[,}]/g) ?? []).length, 1, "enabled is set in more than one place");
    assert.match(rules, /export async function setAutopublishRuleEnabled[\s\S]*?canManagePublishing\(role\)/);
    const migration = await read("db/migrations/0037_publishing_queue.sql");
    assert.match(migration, /"enabled" boolean DEFAULT false NOT NULL/);
    assert.doesNotMatch(migration, /SET "enabled"|INSERT INTO "autopublish_rules"/i);
  });
}
