// Co-Founder interview control checks (step 36): Start over deletes the
// messages, never the facts, and a reply whose answer was deleted meanwhile
// saves nothing; Start over and every answer and reply save take the
// company's row lock, so nothing saved at that moment is left behind; an
// answer is 1-4,000 characters as the box counts them; members read the
// interview but never answer or start over, and an owner made a member
// meanwhile is refused (the role is read again in /db); the per-company
// hourly limit refuses an answer before it is saved or read. A FAKE model
// only: nothing calls Anthropic.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { deleteInterviewMessages, saveInterviewAnswer, saveInterviewReply } from "@/db/onboarding-messages";
import { businessFacts, companies } from "@/db/schema";
import { INTERVIEW_ANSWER_MAX_LENGTH } from "@/lib/cofounder/limits";
import { encryptText } from "@/lib/encryption";
import { onboardingMessageContext } from "@/lib/encryption-contexts";
import { getInterviewForSession, startOverInterviewForSession } from "@/services/onboarding-interview";
import { isOverRateLimit, RATE_LIMITS } from "@/services/rate-limit";
import { changeTeammateRoleForSession } from "@/services/team";
import { answerLikeThePage, factRow, messageOf, messageRows, scriptedModel, shownConversation, turnAnswer, typeFact } from "./cofounder-helpers";
import { holdLocks, isStillWaiting } from "./concurrency-checks";
import { addTeammate, check, sessionFor, signUpTestOwner } from "./helpers";

export async function runCofounderInterviewControlChecks() {
  await check("co-founder interview: Start over deletes the messages and never the facts; a reply whose answer was deleted meanwhile saves nothing", async () => {
    const ownerUser = await signUpTestOwner("interview-restart");
    const owner = sessionFor(ownerUser);
    const model = scriptedModel([turnAnswer({ proposed_facts: [{ topic: "company_name", value: "Bluebird Bakery" }], next_question: "What do you do?" })]);
    assert.ok((await answerLikeThePage(owner, "Bluebird Bakery.", model.ask)).ok);
    await typeFact(owner, "industry", "Bakery");
    assert.deepEqual(await startOverInterviewForSession(owner), { ok: true });
    assert.deepEqual(await messageRows(owner.companyId), []);
    assert.equal((await factRow(owner.companyId, "company_name"))?.proposedValue, "Bluebird Bakery");
    assert.equal((await factRow(owner.companyId, "industry"))?.confirmedValue, "Bakery");
    // It starts again from the first key topic with nothing at all.
    assert.equal((await getInterviewForSession(owner)).opening?.topic, "description");

    // Another owner starts over while the AI reads an answer.
    const otherOwner = sessionFor(await addTeammate(ownerUser, "interview-restart-owner", "owner"));
    const racing = scriptedModel([turnAnswer({ proposed_facts: [{ topic: "description", value: "Bakes bread." }], next_question: "Who buys it?" })], async () => {
      assert.deepEqual(await startOverInterviewForSession(otherOwner), { ok: true });
    });
    assert.match(messageOf(await answerLikeThePage(owner, "We bake bread.", racing.ask)), /started over while the AI read your answer/);
    assert.deepEqual(await messageRows(owner.companyId), []);
    assert.equal(await factRow(owner.companyId, "description"), undefined);
  });

  await check("co-founder interview: Start over waits for the company's row lock, the one every answer holds while it is saved, so no answer is left behind without its question", async () => {
    const owner = sessionFor(await signUpTestOwner("interview-restart-lock"));
    assert.ok((await answerLikeThePage(owner, "Bluebird Bakery.", scriptedModel([turnAnswer({ next_question: "What do you do?" })]).ask)).ok);
    const release = await holdLocks((tx) => tx.select({ id: companies.id }).from(companies).where(eq(companies.id, owner.companyId)).for("no key update"));
    const startOver = startOverInterviewForSession(owner);
    const waited = await isStillWaiting(startOver);
    await release();
    assert.equal(waited, true, "Start over did not wait for the company's row lock");
    assert.deepEqual(await startOver, { ok: true });
    assert.deepEqual(await messageRows(owner.companyId), []);
  });

  await check("co-founder interview: a reply being saved when Start over begins is deleted with the rest, never left behind as a lone question", async () => {
    const ownerUser = await signUpTestOwner("interview-restart-reply");
    const owner = sessionFor(ownerUser);
    const otherOwner = sessionFor(await addTeammate(ownerUser, "interview-restart-reply-owner", "owner"));
    await typeFact(owner, "prices", "Bread from 3 euros");
    const replies = [turnAnswer({ next_question: "What do you sell?" }), turnAnswer({ proposed_facts: [{ topic: "prices", value: "Bread from 4 euros" }], next_question: "Who buys it?" })];
    const model = scriptedModel(replies);
    assert.ok((await answerLikeThePage(owner, "Bluebird Bakery.", model.ask)).ok);
    // The prices row locked here holds the second reply's transaction open at its proposal.
    const pricesRow = and(eq(businessFacts.companyId, owner.companyId), eq(businessFacts.topic, "prices"));
    const release = await holdLocks((tx) => tx.select({ id: businessFacts.id }).from(businessFacts).where(pricesRow).for("update"));
    const answering = answerLikeThePage(owner, "Bread costs 4 euros.", model.ask);
    const answerWaited = await isStillWaiting(answering);
    const startOver = startOverInterviewForSession(otherOwner);
    const startOverWaited = await isStillWaiting(startOver);
    await release();
    assert.deepEqual([answerWaited, startOverWaited], [true, true], "the reply or Start over did not wait");
    assert.ok((await answering).ok);
    assert.deepEqual(await startOver, { ok: true });
    assert.deepEqual(await messageRows(owner.companyId), [], "a message was left behind after Start over");
    assert.equal((await factRow(owner.companyId, "prices"))?.proposedValue, "Bread from 4 euros");
  });

  await check("co-founder interview: an answer is 1-4,000 characters with a line break counting once, as the box counts; a longer, blank or control-character one is refused before it is saved or read", async () => {
    const owner = sessionFor(await signUpTestOwner("interview-length"));
    const model = scriptedModel([turnAnswer({ next_question: "And then?" })]);
    const tooLong = await answerLikeThePage(owner, "x".repeat(INTERVIEW_ANSWER_MAX_LENGTH + 1), model.ask);
    assert.deepEqual(!tooLong.ok && tooLong.errors.fieldErrors?.answer, ["An answer can be at most 4,000 characters."]);
    for (const answer of ["   \n ", "Hidden \u0000 byte", "Bell \u0007 here"]) {
      const result = await answerLikeThePage(owner, answer, model.ask);
      assert.ok(!result.ok && result.errors.fieldErrors?.answer, `accepted ${JSON.stringify(answer)}`);
    }
    assert.deepEqual([model.requests.length, (await messageRows(owner.companyId)).length], [0, 0]);
    // 2,000 lines sent with \r\n, as browsers send a box's line breaks: 3,999 characters as the box counts them.
    const lines = Array.from({ length: 2000 }, () => "y");
    assert.ok((await answerLikeThePage(owner, lines.join("\r\n"), model.ask)).ok);
    assert.equal((await shownConversation(owner))[1][1], lines.join("\n"));
  });

  await check("co-founder interview: members read the interview but can't answer or start over (services and /db); an owner made a member meanwhile is refused", async () => {
    const ownerUser = await signUpTestOwner("interview-roles");
    const owner = sessionFor(ownerUser);
    const member = sessionFor(await addTeammate(ownerUser, "interview-member", "member"));
    const model = scriptedModel([turnAnswer({ next_question: "What do you sell?" })]);
    assert.ok((await answerLikeThePage(owner, "Bluebird Bakery.", model.ask)).ok);
    const shownToOwner = await shownConversation(owner);
    assert.deepEqual(await shownConversation(member), shownToOwner, "members read the same conversation");
    assert.match(messageOf(await answerLikeThePage(member, "A member's answer", model.ask)), /Only owners answer/);
    assert.match(messageOf(await startOverInterviewForSession(member)), /Only owners can start the interview over/);
    assert.equal(model.requests.length, 1, "Claude was asked for a member");

    // Straight to /db as the member: the role read there refuses too.
    const id = randomUUID();
    const message = { id, bodyEncrypted: encryptText("x", onboardingMessageContext(member.companyId, id)) };
    assert.equal(await saveInterviewAnswer(member.companyId, member.userId, { opening: null, answer: message }), "not-allowed");
    assert.equal(await deleteInterviewMessages(member.companyId, member.userId), "not-allowed");
    const answerId = (await messageRows(owner.companyId))[1].id;
    const reply = { answerId, message, endsInterview: false, proposals: [{ topic: "industry" as const, value: "Sneaky" }] };
    assert.deepEqual(await saveInterviewReply(member.companyId, member.userId, reply), { outcome: "not-allowed" });
    assert.deepEqual(await shownConversation(owner), shownToOwner);
    assert.equal(await factRow(owner.companyId, "industry"), undefined);

    // An owner made a member while their page is open: the session still says "owner".
    const demotedUser = await addTeammate(ownerUser, "interview-demoted", "owner");
    const staleSession = sessionFor(demotedUser);
    assert.deepEqual(await changeTeammateRoleForSession(owner, { userId: demotedUser.id, role: "member" }), { ok: true });
    assert.match(messageOf(await answerLikeThePage(staleSession, "A stale answer", model.ask)), /Only owners answer/);
    assert.match(messageOf(await startOverInterviewForSession(staleSession)), /Only owners can start the interview over/);
    assert.deepEqual(await shownConversation(owner), shownToOwner);
  });

  await check("co-founder interview: the per-company hourly limit refuses an answer before it is saved or read; another company still answers", async () => {
    const ownerUser = await signUpTestOwner("interview-limit");
    const owner = sessionFor(ownerUser);
    const secondOwner = sessionFor(await addTeammate(ownerUser, "interview-limit-owner", "owner"));
    for (let attempt = 0; attempt < RATE_LIMITS.onboardingTurnsPerCompany.maxAttempts; attempt++) {
      await isOverRateLimit("onboarding-turns", owner.companyId, RATE_LIMITS.onboardingTurnsPerCompany);
    }
    const model = scriptedModel([turnAnswer({ next_question: "Next?" })]);
    // Every owner of the company shares it: each answer is a paid Claude call.
    for (const session of [owner, secondOwner]) {
      assert.match(messageOf(await answerLikeThePage(session, "One answer too many", model.ask)), /answered a lot of questions this hour/);
    }
    assert.deepEqual([model.requests.length, (await messageRows(owner.companyId)).length], [0, 0]);
    const elsewhere = sessionFor(await signUpTestOwner("interview-limit-elsewhere"));
    assert.ok((await answerLikeThePage(elsewhere, "Bluebird Bakery.", model.ask)).ok);
  });
}
