// Business profile rule checks (step 36): members read the profile but
// never confirm, edit or dismiss, and an owner made a member meanwhile is
// refused (the role is read again in /db); the completion counts confirmed
// key facts only, and the Overview's next steps follow it; a fact's length
// and characters are checked in Zod and in the database's CHECKs; and
// proposals carrying fields of their own write only the proposal.

import assert from "node:assert/strict";
import { saveKnowledgeFactProposals } from "@/db/business-fact-proposals";
import { confirmBusinessFactProposal, dismissBusinessFactProposal, saveBusinessFactValue } from "@/db/business-facts";
import { db } from "@/db/client";
import { businessFacts } from "@/db/schema";
import { KEY_FACT_TOPICS } from "@/lib/business-facts";
import type { FactProposal } from "@/lib/cofounder/fact-proposals";
import { confirmFactForSession, dismissProposalForSession, getBusinessProfileForSession, saveFactForSession } from "@/services/business-profile";
import { getCoFounderOverviewForSession } from "@/services/cofounder-overview";
import { changeTeammateRoleForSession } from "@/services/team";
import { factRow, factRows, messageOf, proposeInInterview, typeFact } from "./cofounder-helpers";
import { addTeammate, assertRefusedByConstraint, check, sessionFor, signUpTestOwner } from "./helpers";

export async function runCofounderProfileRuleChecks() {
  await check("business profile: members read the profile but can't confirm, edit or dismiss (services and /db); an owner made a member meanwhile is refused", async () => {
    const ownerUser = await signUpTestOwner("profile-roles");
    const owner = sessionFor(ownerUser);
    const member = sessionFor(await addTeammate(ownerUser, "profile-member", "member"));
    await typeFact(owner, "industry", "Bakery");
    await proposeInInterview(owner, [{ topic: "company_name", value: "Bluebird Bakery" }]);
    const rows = await factRows(owner.companyId);
    assert.deepEqual(JSON.stringify(await getBusinessProfileForSession(member)), JSON.stringify(await getBusinessProfileForSession(owner)));
    assert.match(messageOf(await confirmFactForSession(member, { topic: "company_name", shownProposal: "Bluebird Bakery", shownConfirmedValue: "" })), /Only owners/);
    assert.match(messageOf(await dismissProposalForSession(member, { topic: "company_name", shownProposal: "Bluebird Bakery" })), /Only owners/);
    assert.match(messageOf(await saveFactForSession(member, { topic: "industry", value: "Members' bakery", originalValue: "Bakery" })), /Only owners/);
    const confirmation = { topic: "company_name" as const, shownProposal: "Bluebird Bakery", shownConfirmedValue: null, value: "Bluebird Bakery" };
    assert.equal(await confirmBusinessFactProposal(member.companyId, member.userId, confirmation), "not-allowed");
    assert.equal(await dismissBusinessFactProposal(member.companyId, member.userId, confirmation), "not-allowed");
    assert.equal(await saveBusinessFactValue(member.companyId, member.userId, { topic: "industry", originalValue: "Bakery", value: "x" }), "not-allowed");
    assert.deepEqual(await saveKnowledgeFactProposals(member.companyId, member.userId, [{ topic: "prices", value: "x" }]), { outcome: "not-allowed" });

    const demotedUser = await addTeammate(ownerUser, "profile-demoted", "owner");
    assert.deepEqual(await changeTeammateRoleForSession(owner, { userId: demotedUser.id, role: "member" }), { ok: true });
    // The session still says "owner", as one read just before the change would.
    const staleSession = sessionFor(demotedUser);
    assert.match(messageOf(await confirmFactForSession(staleSession, { topic: "company_name", shownProposal: "Bluebird Bakery", shownConfirmedValue: "" })), /Only owners/);
    assert.match(messageOf(await saveFactForSession(staleSession, { topic: "industry", value: "x", originalValue: "Bakery" })), /Only owners/);
    assert.deepEqual(await factRows(owner.companyId), rows);
  });

  await check("business profile: the completion counts confirmed key facts only, and the Overview's next steps follow it (owners only)", async () => {
    const ownerUser = await signUpTestOwner("profile-completion");
    const owner = sessionFor(ownerUser);
    const member = sessionFor(await addTeammate(ownerUser, "profile-completion-member", "member"));
    const keyTotal = KEY_FACT_TOPICS.length;
    const labelsOf = async () => (await getCoFounderOverviewForSession(owner)).nextSteps.map((step) => step.label);
    let overview = await getCoFounderOverviewForSession(owner);
    assert.deepEqual([overview.completion, overview.interviewStarted], [{ keyConfirmed: 0, keyTotal, proposalsWaiting: 0 }, false]);
    assert.deepEqual(await labelsOf(), ["Start the interview"]);
    assert.deepEqual((await getCoFounderOverviewForSession(member)).nextSteps, []);

    await proposeInInterview(owner, [{ topic: "company_name", value: "Bluebird Bakery" }]);
    assert.deepEqual(await labelsOf(), ["Confirm 1 proposed fact", "Continue the interview"]);
    assert.deepEqual((await getBusinessProfileForSession(owner)).completion, { keyConfirmed: 0, keyTotal, proposalsWaiting: 1 });
    assert.deepEqual(await confirmFactForSession(owner, { topic: "company_name", shownProposal: "Bluebird Bakery", shownConfirmedValue: "" }), { ok: true });
    // A topic that isn't a key fact doesn't count.
    await typeFact(owner, "website", "https://bluebird.test");
    overview = await getCoFounderOverviewForSession(owner);
    assert.deepEqual([overview.completion.keyConfirmed, overview.missingKeyTopics.length], [1, keyTotal - 1]);

    for (const topic of KEY_FACT_TOPICS.slice(1)) {
      await typeFact(owner, topic, `Known ${topic}`);
    }
    assert.deepEqual((await getBusinessProfileForSession(owner)).completion, { keyConfirmed: keyTotal, keyTotal, proposalsWaiting: 0 });
    assert.deepEqual(await labelsOf(), ["Review your business profile"]);
  });

  await check("business profile: a fact is 1-2,000 characters with a line break counting once; control characters and unknown topics are refused; the database CHECKs hold", async () => {
    const ownerUser = await signUpTestOwner("profile-fields");
    const owner = sessionFor(ownerUser);
    for (const value of ["", "  \n ", "x".repeat(2001), "Hidden \u0000 byte", "Bell \u0007 here"]) {
      const result = await saveFactForSession(owner, { topic: "industry", value, originalValue: "" });
      assert.ok(!result.ok && result.errors.fieldErrors?.value, `accepted ${JSON.stringify(value).slice(0, 40)}`);
    }
    assert.match(messageOf(await saveFactForSession(owner, { topic: "secret_plans", value: "x", originalValue: "" })), /Unknown topic/);
    assert.match(messageOf(await confirmFactForSession(owner, { topic: "industry", shownProposal: "", shownConfirmedValue: "" })), /Unknown topic or proposal/);
    // 1,000 lines sent with \r\n: 1,999 characters as the box counts them.
    const lines = Array.from({ length: 1000 }, () => "y");
    assert.deepEqual(await saveFactForSession(owner, { topic: "industry", value: lines.join("\r\n"), originalValue: "" }), { ok: true });
    assert.equal((await factRow(owner.companyId, "industry"))?.confirmedValue, lines.join("\n"));

    const row = { companyId: ownerUser.companyId, topic: "prices" as const };
    await assertRefusedByConstraint(
      db.insert(businessFacts).values({ ...row, confirmedValue: "x".repeat(2001), confirmedSource: "owner", confirmedByUserId: ownerUser.id, confirmedAt: new Date() }),
      "business_facts_confirmed_value_length",
    );
    await assertRefusedByConstraint(db.insert(businessFacts).values({ ...row, confirmedValue: "x" }), "business_facts_confirmation_fields_together");
    await assertRefusedByConstraint(db.insert(businessFacts).values({ ...row, proposedValue: "x", proposedAt: new Date() }), "business_facts_proposal_fields_together");
    await assertRefusedByConstraint(
      db.insert(businessFacts).values({ ...row, proposedValue: "x", proposedSource: "owner" as "interview", proposedAt: new Date() }),
      "business_facts_proposed_source_known",
    );
  });

  await check("trusted fields: proposals carrying a company, a confirmed value or a source of their own write only the proposal, for the company given", async () => {
    const ownerA = sessionFor(await signUpTestOwner("profile-trusted-a"));
    const ownerB = sessionFor(await signUpTestOwner("profile-trusted-b"));
    await typeFact(ownerA, "industry", "Bakery");
    const sneaky = { topic: "industry", value: "Retail", companyId: ownerB.companyId, confirmedValue: "Taken over", proposedSource: "owner" };
    assert.deepEqual(await saveKnowledgeFactProposals(ownerA.companyId, ownerA.userId, [sneaky as FactProposal]), { outcome: "saved", proposedTopics: ["industry"] });
    const industry = await factRow(ownerA.companyId, "industry");
    assert.deepEqual([industry?.confirmedValue, industry?.proposedValue, industry?.proposedSource], ["Bakery", "Retail", "knowledge"]);
    assert.deepEqual(await factRows(ownerB.companyId), []);
  });
}
