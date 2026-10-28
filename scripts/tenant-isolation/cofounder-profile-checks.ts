// Business profile checks (step 36): one company can never read, confirm,
// dismiss or edit another's facts or proposals (services and /db, and the
// database refuses a confirmer or an interview author from another company);
// a proposal never overwrites a confirmed value; Confirm, "Edit and confirm"
// and an owner's own edit record who and where from; and a confirm, dismiss
// or edit of something changed meanwhile is refused (a confirm also when the
// fact beside the proposal changed). Roles, completion and field rules:
// cofounder-profile-rule-checks.ts.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { saveKnowledgeFactProposals } from "@/db/business-fact-proposals";
import { confirmBusinessFactProposal, dismissBusinessFactProposal, saveBusinessFactValue } from "@/db/business-facts";
import { db } from "@/db/client";
import { businessFacts, onboardingMessages } from "@/db/schema";
import { confirmFactForSession, dismissProposalForSession, getBusinessProfileForSession, saveFactForSession } from "@/services/business-profile";
import { factRow, factRows, messageOf, proposeInInterview, typeFact } from "./cofounder-helpers";
import { addTeammate, assertRefusedByConstraint, check, runId, sessionFor, signUpTestOwner } from "./helpers";

export async function runCofounderProfileChecks() {
  await check("business profile: another company can't read, confirm, dismiss or edit a company's facts or proposals (services and /db)", async () => {
    const ownerA = sessionFor(await signUpTestOwner("profile-a"));
    const ownerB = sessionFor(await signUpTestOwner("profile-b"));
    await typeFact(ownerA, "industry", `Bakery ${runId}`);
    await proposeInInterview(ownerA, [{ topic: "company_name", value: `Bluebird ${runId}` }]);
    const rowsOfA = await factRows(ownerA.companyId);

    const profileOfB = JSON.stringify(await getBusinessProfileForSession(ownerB));
    assert.ok(!profileOfB.includes(runId), "company B's profile shows company A's facts");
    // B's forms naming A's topics and values act on B's own profile only, where they match nothing.
    assert.match(messageOf(await confirmFactForSession(ownerB, { topic: "company_name", shownProposal: `Bluebird ${runId}`, shownConfirmedValue: "" })), /changed or was handled meanwhile/);
    assert.match(messageOf(await dismissProposalForSession(ownerB, { topic: "company_name", shownProposal: `Bluebird ${runId}` })), /changed or was handled meanwhile/);
    assert.match(messageOf(await saveFactForSession(ownerB, { topic: "industry", value: "Taken over", originalValue: `Bakery ${runId}` })), /Someone changed this fact/);
    // Straight to /db with a person from the other company: refused before anything is written.
    const confirmation = { topic: "company_name" as const, shownProposal: `Bluebird ${runId}`, shownConfirmedValue: null, value: `Bluebird ${runId}` };
    assert.equal(await confirmBusinessFactProposal(ownerA.companyId, ownerB.userId, confirmation), "not-allowed");
    assert.equal(await dismissBusinessFactProposal(ownerA.companyId, ownerB.userId, confirmation), "not-allowed");
    assert.equal(await saveBusinessFactValue(ownerA.companyId, ownerB.userId, { topic: "industry", originalValue: `Bakery ${runId}`, value: "x" }), "not-allowed");
    assert.deepEqual(await saveKnowledgeFactProposals(ownerA.companyId, ownerB.userId, [{ topic: "prices", value: "x" }]), { outcome: "not-allowed" });
    assert.deepEqual(await factRows(ownerA.companyId), rowsOfA);
    assert.deepEqual(await factRows(ownerB.companyId), []);

    // The database itself refuses a confirmer or an interview author from another company.
    const [industryOfA] = rowsOfA.filter((row) => row.topic === "industry");
    await assertRefusedByConstraint(
      db.update(businessFacts).set({ confirmedByUserId: ownerB.userId }).where(eq(businessFacts.id, industryOfA.id)),
      "business_facts_confirmer_in_same_company_fk",
    );
    await assertRefusedByConstraint(
      db.insert(onboardingMessages).values({ id: randomUUID(), companyId: ownerA.companyId, author: "owner", authorUserId: ownerB.userId, bodyEncrypted: "v1:x" }),
      "onboarding_messages_author_in_same_company_fk",
    );
  });

  await check("business profile: a proposal never overwrites a confirmed value; Confirm makes it the fact with its source, Edit and confirm and an owner's edit record the owner", async () => {
    const owner = sessionFor(await signUpTestOwner("profile-proposals"));
    await typeFact(owner, "industry", "Bakery");
    await proposeInInterview(owner, [{ topic: "industry", value: "Food and drink" }]);
    let industry = await factRow(owner.companyId, "industry");
    assert.deepEqual([industry?.confirmedValue, industry?.confirmedSource, industry?.proposedValue, industry?.proposedSource], ["Bakery", "owner", "Food and drink", "interview"]);
    // A newer proposal (from knowledge) takes the waiting one's place; the confirmed value stays.
    assert.deepEqual(await saveKnowledgeFactProposals(owner.companyId, owner.userId, [{ topic: "industry", value: "Retail" }]), { outcome: "saved", proposedTopics: ["industry"] });
    // One that says what is already confirmed, or already waiting, writes nothing.
    assert.deepEqual(await saveKnowledgeFactProposals(owner.companyId, owner.userId, [{ topic: "industry", value: "Bakery" }, { topic: "industry", value: "Retail" }]), { outcome: "saved", proposedTopics: [] });
    industry = await factRow(owner.companyId, "industry");
    assert.deepEqual([industry?.confirmedValue, industry?.proposedValue, industry?.proposedSource], ["Bakery", "Retail", "knowledge"]);

    assert.deepEqual(await confirmFactForSession(owner, { topic: "industry", shownProposal: "Retail", shownConfirmedValue: "Bakery" }), { ok: true });
    industry = await factRow(owner.companyId, "industry");
    assert.deepEqual([industry?.confirmedValue, industry?.confirmedSource, industry?.confirmedByUserId, industry?.proposedValue], ["Retail", "knowledge", owner.userId, null]);

    // Edit and confirm: the owner's words, source "owner".
    await proposeInInterview(owner, [{ topic: "industry", value: "Bakery and cafe" }]);
    assert.deepEqual(await confirmFactForSession(owner, { topic: "industry", shownProposal: "Bakery and cafe", shownConfirmedValue: "Retail", value: "Bakery and cafe\r\nin Lisbon" }), { ok: true });
    industry = await factRow(owner.companyId, "industry");
    assert.deepEqual([industry?.confirmedValue, industry?.confirmedSource, industry?.proposedValue], ["Bakery and cafe\nin Lisbon", "owner", null]);

    // Dismiss drops the proposal only.
    await proposeInInterview(owner, [{ topic: "industry", value: "Catering" }]);
    assert.deepEqual(await dismissProposalForSession(owner, { topic: "industry", shownProposal: "Catering" }), { ok: true });
    industry = await factRow(owner.companyId, "industry");
    assert.deepEqual([industry?.confirmedValue, industry?.proposedValue, industry?.proposedSource, industry?.proposedAt], ["Bakery and cafe\nin Lisbon", null, null, null]);

    // An owner typing exactly what waits: nothing is left to confirm.
    await proposeInInterview(owner, [{ topic: "industry", value: "Bakery" }]);
    await typeFact(owner, "industry", "Bakery");
    industry = await factRow(owner.companyId, "industry");
    assert.deepEqual([industry?.confirmedValue, industry?.confirmedSource, industry?.proposedValue], ["Bakery", "owner", null]);
  });

  await check("business profile: a confirm or dismiss of a proposal changed meanwhile, or an edit of a fact changed meanwhile, is refused and changes nothing", async () => {
    const ownerUser = await signUpTestOwner("profile-stale");
    const owner = sessionFor(ownerUser);
    const otherOwner = sessionFor(await addTeammate(ownerUser, "profile-stale-owner", "owner"));
    await proposeInInterview(owner, [{ topic: "prices", value: "Bread from 3 euros" }]);
    // A newer proposal arrives after the page showed the first one.
    await saveKnowledgeFactProposals(owner.companyId, owner.userId, [{ topic: "prices", value: "Bread from 4 euros" }]);
    assert.match(messageOf(await confirmFactForSession(owner, { topic: "prices", shownProposal: "Bread from 3 euros", shownConfirmedValue: "" })), /changed or was handled meanwhile/);
    assert.match(messageOf(await dismissProposalForSession(owner, { topic: "prices", shownProposal: "Bread from 3 euros" })), /changed or was handled meanwhile/);
    assert.deepEqual([(await factRow(owner.companyId, "prices"))?.proposedValue, (await factRow(owner.companyId, "prices"))?.confirmedValue], ["Bread from 4 euros", null]);

    // Two owners open the same empty topic and both save: the second is told, nothing is overwritten.
    assert.deepEqual(await saveFactForSession(owner, { topic: "website", value: "https://bluebird.test", originalValue: "" }), { ok: true });
    assert.match(messageOf(await saveFactForSession(otherOwner, { topic: "website", value: "https://other.test", originalValue: "" })), /Someone changed this fact after you opened it/);
    // At the very same moment, with no row to lock yet: exactly one wins.
    const results = await Promise.all([
      saveFactForSession(owner, { topic: "location", value: "Lisbon", originalValue: "" }),
      saveFactForSession(otherOwner, { topic: "location", value: "Porto", originalValue: "" }),
    ]);
    assert.deepEqual(results.map((result) => result.ok).sort(), [false, true]);
    const location = await factRow(owner.companyId, "location");
    assert.equal(location?.confirmedValue, results[0].ok ? "Lisbon" : "Porto");
    // Saving what is already stored changes nothing.
    const before = await factRow(owner.companyId, "website");
    assert.deepEqual(await saveFactForSession(owner, { topic: "website", value: "https://bluebird.test", originalValue: "https://bluebird.test" }), { ok: true });
    assert.deepEqual(await factRow(owner.companyId, "website"), before);
  });

  await check("business profile: Confirm and Edit and confirm are refused when the confirmed value changed after the page showed it; the newer value stays", async () => {
    const ownerUser = await signUpTestOwner("profile-confirm-stale");
    const owner = sessionFor(ownerUser);
    const otherOwner = sessionFor(await addTeammate(ownerUser, "profile-confirm-stale-owner", "owner"));
    await typeFact(owner, "prices", "Bread from 3 euros");
    await proposeInInterview(owner, [{ topic: "prices", value: "Bread from 4 euros" }]);
    // The page shows "3 euros" with the proposal beside it; another owner types "5 euros" meanwhile (the proposal stays).
    assert.deepEqual(await saveFactForSession(otherOwner, { topic: "prices", value: "Bread from 5 euros", originalValue: "Bread from 3 euros" }), { ok: true });
    const shown = { topic: "prices", shownProposal: "Bread from 4 euros", shownConfirmedValue: "Bread from 3 euros" };
    assert.match(messageOf(await confirmFactForSession(owner, shown)), /changed or was handled meanwhile/);
    assert.match(messageOf(await confirmFactForSession(owner, { ...shown, value: "Bread from 4.50 euros" })), /changed or was handled meanwhile/);
    // A form without the confirmed value it showed is refused too.
    assert.match(messageOf(await confirmFactForSession(owner, { topic: "prices", shownProposal: "Bread from 4 euros" })), /Unknown topic or proposal/);
    let prices = await factRow(owner.companyId, "prices");
    assert.deepEqual([prices?.confirmedValue, prices?.confirmedByUserId, prices?.proposedValue], ["Bread from 5 euros", otherOwner.userId, "Bread from 4 euros"]);
    // Reloaded, the page shows "5 euros": now the owner confirms what they see.
    assert.deepEqual(await confirmFactForSession(owner, { ...shown, shownConfirmedValue: "Bread from 5 euros" }), { ok: true });
    prices = await factRow(owner.companyId, "prices");
    assert.deepEqual([prices?.confirmedValue, prices?.confirmedByUserId, prices?.proposedValue], ["Bread from 4 euros", owner.userId, null]);

    // A topic with no value on the page: one typed meanwhile stops the confirm as well.
    await proposeInInterview(owner, [{ topic: "location", value: "Lisbon" }]);
    await typeFact(otherOwner, "location", "Porto");
    assert.match(messageOf(await confirmFactForSession(owner, { topic: "location", shownProposal: "Lisbon", shownConfirmedValue: "" })), /changed or was handled meanwhile/);
    assert.deepEqual([(await factRow(owner.companyId, "location"))?.confirmedValue, (await factRow(owner.companyId, "location"))?.proposedValue], ["Porto", "Lisbon"]);
  });
}
