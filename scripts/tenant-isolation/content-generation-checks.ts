// Content generation checks (step 38): the AI can't mark its own claim
// supported (this code decides, and decides again on what is stored); a
// failed, refused, cut-off or unusable answer changes nothing, new draft or
// regenerated; without the key facts Claude is never asked; and the hourly
// limit per company refuses before Claude is asked. A FAKE model only:
// nothing calls Anthropic.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { contentDrafts } from "@/db/schema";
import type { ModelResult } from "@/lib/model-request";
import { createBlankDraftForSession, getContentDraftPageForSession } from "@/services/content-drafts";
import { isOverRateLimit, RATE_LIMITS } from "@/services/rate-limit";
import { messageOf, modelAnswer, proposeInInterview } from "./cofounder-helpers";
import { draftAnswer, draftRow, generateDraft, generatedDraftId, LINKEDIN_POST, makeReadyForDrafts, regenerateDraft } from "./content-studio-helpers";
import { addTeammate, captureConsole, check, sessionFor, signUpTestOwner } from "./helpers";

async function draftCount(companyId: string): Promise<number> {
  return (await db.select({ id: contentDrafts.id }).from(contentDrafts).where(eq(contentDrafts.companyId, companyId))).length;
}

export async function runContentGenerationChecks() {
  await check("content studio: the AI can't mark its own claim supported: this code backs a claim only when every fact it names was confirmed and sent, a 'supported' field makes the answer unusable, and a stored claim is checked again", async () => {
    const owner = sessionFor(await signUpTestOwner("studio-claim-rule"));
    await makeReadyForDrafts(owner);
    // A proposed price is the AI's reading of an answer, not a confirmed fact.
    await proposeInInterview(owner, [{ topic: "prices", value: "Bread from 3 euros" }]);
    const claims = [
      { text: "We bake in Lisbon.", fact_topics: ["description"] },
      { text: "Bread from 3 euros.", fact_topics: ["prices"] },
      { text: "Sourdough from 3 euros.", fact_topics: ["products", "prices"] },
      { text: "Loved by everyone.", fact_topics: [] },
    ];
    const draftId = await generatedDraftId(owner, undefined, draftAnswer({ claims }));
    assert.deepEqual((await draftRow(draftId)).claims, [
      { text: "We bake in Lisbon.", supported: true, fact_topics: ["description"] },
      { text: "Bread from 3 euros.", supported: false, fact_topics: ["prices"] },
      { text: "Sourdough from 3 euros.", supported: false, fact_topics: ["products", "prices"] },
      { text: "Loved by everyone.", supported: false, fact_topics: [] },
    ]);
    const statuses = async () => (await getContentDraftPageForSession(owner, draftId))?.review.claims.map((claim) => claim.status);
    assert.deepEqual(await statuses(), ["backed", "fact_not_confirmed", "fact_not_confirmed", "no_fact"]);

    // The AI saying a claim is supported makes the whole answer unusable.
    const selfMarked = draftAnswer({ claims: [{ text: "We bake in Lisbon.", fact_topics: ["description"], supported: true }] });
    const { result } = await generateDraft(owner, LINKEDIN_POST, selfMarked);
    assert.match(messageOf(result), /came back in a form that can't be used, so nothing was saved/);
    assert.equal(await draftCount(owner.companyId), 1);

    // A stored claim marked supported is backed only by facts the draft was written from.
    await db
      .update(contentDrafts)
      .set({ claims: [{ text: "Bread from 3 euros.", supported: true, fact_topics: ["prices"] }] })
      .where(eq(contentDrafts.id, draftId));
    assert.deepEqual(await statuses(), ["fact_not_confirmed"]);
  });

  await check("content studio: a failed, refused, cut-off or unusable answer changes nothing: no new draft, a regenerated draft keeps its content, and a failure logs one fixed line", async () => {
    const owner = sessionFor(await signUpTestOwner("studio-failures"));
    await makeReadyForDrafts(owner);
    const existing = await generatedDraftId(owner);
    const before = await draftRow(existing);
    const notJson: ModelResult = { kind: "ok", outputText: "Here is your post!", usage: { inputTokens: 1, outputTokens: 1 } };
    const failures: [ModelResult, RegExp][] = [
      [{ kind: "unavailable" }, /isn't available right now, so nothing was written/],
      [{ kind: "refused" }, /couldn't write the draft just now/],
      [{ kind: "truncated" }, /couldn't write the draft just now/],
      [{ kind: "error", errorName: "InternalServerError" }, /couldn't write the draft just now/],
      [notJson, /can't be used/],
      [modelAnswer({ body: "Only a body." }), /can't be used/],
      [draftAnswer({ companyId: owner.companyId }), /can't be used/],
      [draftAnswer({ body: "   " }), /can't be used/],
      [draftAnswer({ claims: Array.from({ length: 31 }, (_, index) => ({ text: `Claim ${index}`, fact_topics: [] })) }), /can't be used/],
    ];
    for (const [answer, message] of failures) {
      const created = await generateDraft(owner, LINKEDIN_POST, answer);
      assert.match(messageOf(created.result), message, answer.kind);
      const regenerated = await regenerateDraft(owner, existing, answer);
      assert.match(messageOf(regenerated.result), message, answer.kind);
    }
    assert.equal(await draftCount(owner.companyId), 1);
    assert.deepEqual(await draftRow(existing), before);

    const { logs } = await captureConsole(() => generateDraft(owner, LINKEDIN_POST, { kind: "error", errorName: "AuthenticationError" }));
    assert.deepEqual(logs, ["Claude call failed: AuthenticationError"]);
    const silent = await captureConsole(() => generateDraft(owner, LINKEDIN_POST, { kind: "unavailable" }));
    assert.deepEqual(silent.logs, []);
  });

  await check("content studio: without the key facts Claude is never asked, and the page says what is missing; a blank draft still works", async () => {
    const owner = sessionFor(await signUpTestOwner("studio-no-facts"));
    const { result, model } = await generateDraft(owner);
    assert.match(messageOf(result), /needs these facts confirmed first: What the business does, Products or services, Target customers\./);
    const idea = await createBlankDraftForSession(owner, LINKEDIN_POST);
    assert.ok(idea.ok, messageOf(idea));
    const regenerated = await regenerateDraft(owner, idea.draftId);
    assert.match(messageOf(regenerated.result), /needs these facts confirmed first/);
    assert.deepEqual([model.requests.length, regenerated.model.requests.length], [0, 0], "Claude was asked");
    assert.equal((await draftRow(idea.draftId)).status, "idea");
  });

  await check("content studio: the hourly limit per company refuses before Claude is asked, for everyone in it; another company still writes; blank drafts count per person", async () => {
    const ownerUser = await signUpTestOwner("studio-limit");
    const owner = sessionFor(ownerUser);
    const member = sessionFor(await addTeammate(ownerUser, "studio-limit-member", "member"));
    const elsewhere = sessionFor(await signUpTestOwner("studio-limit-elsewhere"));
    await makeReadyForDrafts(owner);
    await makeReadyForDrafts(elsewhere);
    for (let attempt = 0; attempt < RATE_LIMITS.contentGenerationsPerCompany.maxAttempts; attempt++) {
      await isOverRateLimit("content-generations", owner.companyId, RATE_LIMITS.contentGenerationsPerCompany);
    }
    for (const session of [owner, member]) {
      const { result, model } = await generateDraft(session);
      assert.match(messageOf(result), /a lot of drafts this hour/);
      assert.equal(model.requests.length, 0, "Claude was asked over the limit");
    }
    assert.equal(await draftCount(owner.companyId), 0);
    assert.ok((await generateDraft(elsewhere)).result.ok);

    for (let attempt = 0; attempt < RATE_LIMITS.contentDraftChangesPerUser.maxAttempts; attempt++) {
      await isOverRateLimit("content-draft-changes", member.userId, RATE_LIMITS.contentDraftChangesPerUser);
    }
    assert.match(messageOf(await createBlankDraftForSession(member, LINKEDIN_POST)), /Too many changes/);
    assert.ok((await createBlankDraftForSession(owner, LINKEDIN_POST)).ok);
  });
}
