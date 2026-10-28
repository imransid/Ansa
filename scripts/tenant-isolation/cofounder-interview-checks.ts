// Co-Founder interview checks (step 36): the first answer saves the opening
// question the page showed (fixed text, no Claude call for it) before it,
// then Claude's proposals and next question; without a usable answer from
// Claude (no key, refused, failed, cut off, malformed) the answer is still
// saved, nothing is proposed and the fixed question of the first missing key
// topic comes next; Claude's odd entries are dropped one by one; and it ends
// the interview only when no key topic is missing, and the pages call it
// finished only while none is. Start over, roles and the limit:
// cofounder-interview-control-checks.ts. A FAKE model only: nothing calls
// Anthropic.

import assert from "node:assert/strict";
import { BUSINESS_FACT_TOPICS, KEY_FACT_TOPICS } from "@/lib/business-facts";
import { buildOpeningMessage, COULD_NOT_READ_NOTE } from "@/lib/cofounder/interview-reply";
import { BUSINESS_FACT_MAX_LENGTH, INTERVIEW_QUESTION_MAX_LENGTH } from "@/lib/cofounder/limits";
import type { ModelResult } from "@/lib/model-request";
import { dismissProposalForSession, getBusinessProfileForSession } from "@/services/business-profile";
import { getCoFounderOverviewForSession } from "@/services/cofounder-overview";
import { answerInterviewForSession, getInterviewForSession, startOverInterviewForSession } from "@/services/onboarding-interview";
import { answerLikeThePage, factRow, messageOf, messageRows, modelAnswer, scriptedModel, shownConversation, turnAnswer, typeFact } from "./cofounder-helpers";
import { captureConsole, check, sessionFor, signUpTestOwner } from "./helpers";

export async function runCofounderInterviewChecks() {
  await check("co-founder interview: the first answer saves the opening question the page showed, then the answer, then Claude's question; its facts become proposals", async () => {
    const owner = sessionFor(await signUpTestOwner("interview-flow"));
    const before = await getInterviewForSession(owner);
    assert.deepEqual([before.messages.length, before.opening?.topic, before.opening?.text, before.finished], [0, "company_name", buildOpeningMessage("company_name"), false]);
    const model = scriptedModel([
      turnAnswer({
        proposed_facts: [{ topic: "company_name", value: "Bluebird Bakery" }, { topic: "industry", value: "Bakery" }],
        next_question: "What does Bluebird Bakery sell?",
      }),
    ]);
    const result = await answerLikeThePage(owner, "We are Bluebird Bakery, a small bakery.", model.ask);
    assert.deepEqual(result, {
      ok: true,
      proposedTopics: [{ topic: "company_name", label: "Business name" }, { topic: "industry", label: "Industry" }],
      aiReadAnswer: true,
      fixedQuestionTopic: null,
    });
    // Only the answer needed Claude: the opening question is fixed text.
    assert.equal(model.requests.length, 1);
    assert.deepEqual(await shownConversation(owner), [
      ["assistant", buildOpeningMessage("company_name")],
      ["owner", "We are Bluebird Bakery, a small bakery."],
      ["assistant", "What does Bluebird Bakery sell?"],
    ]);
    const after = await getInterviewForSession(owner);
    assert.deepEqual([after.opening, after.finished, after.messages[1].authorName], [null, false, "Owner interview-flow"]);
    const name = await factRow(owner.companyId, "company_name");
    assert.deepEqual([name?.proposedValue, name?.proposedSource, name?.confirmedValue], ["Bluebird Bakery", "interview", null]);
  });

  await check("co-founder interview: the opening saved is the question the page showed, even after the profile changed; an answer to a conversation started over meanwhile is refused", async () => {
    const owner = sessionFor(await signUpTestOwner("interview-opening"));
    assert.equal((await getInterviewForSession(owner)).opening?.topic, "company_name");
    // The owner fills in the business name on the Profile page in another tab, then answers.
    await typeFact(owner, "company_name", "Bluebird Bakery");
    const model = scriptedModel([turnAnswer({ next_question: "What do you do?" })]);
    assert.ok((await answerInterviewForSession(owner, { answer: "Bluebird Bakery.", openingTopic: "company_name" }, model.ask)).ok);
    assert.equal((await shownConversation(owner))[0][1], buildOpeningMessage("company_name"));

    // A page still showing the old conversation after Start over: its answer has no question left.
    assert.deepEqual(await startOverInterviewForSession(owner), { ok: true });
    assert.match(messageOf(await answerInterviewForSession(owner, { answer: "An answer to an old question" }, model.ask)), /started over while you answered/);
    assert.deepEqual([(await messageRows(owner.companyId)).length, model.requests.length], [0, 1]);

    // "none": the page asked for anything to add. A topic the code doesn't know is refused.
    assert.ok((await answerInterviewForSession(owner, { answer: "Nothing else.", openingTopic: "none" }, model.ask)).ok);
    assert.equal((await shownConversation(owner))[0][1], buildOpeningMessage(null));
    assert.match(messageOf(await answerInterviewForSession(owner, { answer: "x", openingTopic: "secret_plans" }, model.ask)), /could not be sent/);
  });

  await check("co-founder interview: without a usable answer from Claude the answer is still saved, nothing is proposed, and the fixed question of the first missing key topic comes next", async () => {
    const owner = sessionFor(await signUpTestOwner("interview-no-ai"));
    await typeFact(owner, "company_name", "Bluebird Bakery");
    const proposal = [{ topic: "description", value: "Bakes bread." }];
    const unusable: ModelResult[] = [
      { kind: "unavailable" },
      { kind: "refused" },
      { kind: "error", errorName: "APIConnectionTimeoutError" },
      { kind: "truncated" },
      { kind: "ok", outputText: "Sure! The business is a bakery.", usage: { inputTokens: 1, outputTokens: 1 } },
      modelAnswer({ proposed_facts: proposal, next_question: "Next?", interview_complete: false, companyId: "another" }),
      modelAnswer({ proposed_facts: proposal, next_question: "   \n ", interview_complete: false }),
      modelAnswer({ proposed_facts: "description: Bakes bread.", next_question: "Next?", interview_complete: false }),
      modelAnswer({ proposed_facts: proposal, next_question: "Next?" }),
    ];
    for (const [index, reply] of unusable.entries()) {
      const answer = `Answer number ${index}`;
      const { result, logs } = await captureConsole(() => answerLikeThePage(owner, answer, scriptedModel([reply]).ask));
      const fixedTopic = { topic: "description", label: BUSINESS_FACT_TOPICS.description.label };
      assert.deepEqual(result, { ok: true, proposedTopics: [], aiReadAnswer: false, fixedQuestionTopic: fixedTopic }, JSON.stringify(reply));
      const conversation = await shownConversation(owner);
      assert.deepEqual(conversation.slice(-2), [
        ["owner", answer],
        ["assistant", `${COULD_NOT_READ_NOTE} ${BUSINESS_FACT_TOPICS.description.question}`],
      ]);
      // At most one fixed line, with a class or a fixed word: never the answer or Claude's text.
      for (const line of logs) {
        assert.match(line, /^Claude call failed: [A-Za-z_]+$/);
      }
    }
    assert.equal(await factRow(owner.companyId, "description"), undefined, "a fact was proposed from an unusable answer");
  });

  await check("co-founder interview: Claude's odd entries are dropped one by one (unknown topics, empty values, other shapes); values are cut to 2,000, the question to one plain line of 500", async () => {
    const owner = sessionFor(await signUpTestOwner("interview-odd"));
    const model = scriptedModel([
      turnAnswer({
        proposed_facts: [
          { topic: "company_name", value: "  Bluebird\r\nBakery \u0000 " },
          { topic: "secret_plans", value: "Take over the town" },
          { topic: "industry", value: "   " },
          { topic: "products" },
          "services: bread",
          { topic: "goals", value: "Grow", confidence: 0.9 },
          { topic: "products", value: "Sourdough ".repeat(250) },
        ],
        next_question: `What\ndo you\u202E sell?${" Tell me more.".repeat(60)}`,
      }),
    ]);
    const result = await answerLikeThePage(owner, "We bake bread.", model.ask);
    assert.deepEqual(result.ok && result.proposedTopics.map((topic) => topic.topic), ["company_name", "products"]);
    assert.equal((await factRow(owner.companyId, "company_name"))?.proposedValue, "Bluebird\nBakery");
    const products = (await factRow(owner.companyId, "products"))?.proposedValue ?? "";
    assert.ok(products.length <= BUSINESS_FACT_MAX_LENGTH && products.startsWith("Sourdough Sourdough"), `${products.length} characters`);
    for (const topic of ["industry", "goals", "services"] as const) {
      assert.equal(await factRow(owner.companyId, topic), undefined, `${topic} was proposed`);
    }
    const question = (await shownConversation(owner)).at(-1)?.[1] ?? "";
    assert.ok(question.length <= INTERVIEW_QUESTION_MAX_LENGTH && question.startsWith("What do you sell? Tell me more."), question.slice(0, 40));
    assert.ok(!/[\n\u202E]/.test(question));
  });

  await check("co-founder interview: Claude ends the interview only when no key topic is missing (counting what it proposes); otherwise the fixed question of the missing one comes next", async () => {
    const owner = sessionFor(await signUpTestOwner("interview-complete"));
    const [lastButOne, last] = KEY_FACT_TOPICS.slice(-2);
    for (const topic of KEY_FACT_TOPICS.slice(0, -2)) {
      await typeFact(owner, topic, `Known ${topic}`);
    }
    const tooEarly = turnAnswer({ proposed_facts: [{ topic: lastButOne, value: `Proposed ${lastButOne}` }], next_question: "That's everything!", interview_complete: true });
    const early = await answerLikeThePage(owner, "One of the two.", scriptedModel([tooEarly]).ask);
    assert.deepEqual(early.ok && [early.aiReadAnswer, early.fixedQuestionTopic?.topic], [true, last]);
    assert.equal((await shownConversation(owner)).at(-1)?.[1], BUSINESS_FACT_TOPICS[last].question);
    assert.equal((await getInterviewForSession(owner)).finished, false);
    assert.equal((await factRow(owner.companyId, lastButOne))?.proposedValue, `Proposed ${lastButOne}`);

    const closing = "Thank you! Please confirm the proposals on the Profile page.";
    const done = turnAnswer({ proposed_facts: [{ topic: last, value: `Proposed ${last}` }], next_question: closing, interview_complete: true });
    assert.ok((await answerLikeThePage(owner, "The other one.", scriptedModel([done]).ask)).ok);
    const finished = await getInterviewForSession(owner);
    assert.deepEqual([finished.finished, finished.messages.at(-1)?.text], [true, closing]);
    const stored = (await messageRows(owner.companyId)).at(-1);
    assert.deepEqual([stored?.author, stored?.endsInterview], ["assistant", true]);
    // Proposals don't count as confirmed: two key facts still wait for an owner.
    const keyTotal = KEY_FACT_TOPICS.length;
    assert.deepEqual((await getBusinessProfileForSession(owner)).completion, { keyConfirmed: keyTotal - 2, keyTotal, proposalsWaiting: 2 });
    // A later answer that doesn't end it opens it again.
    assert.ok((await answerLikeThePage(owner, "One more thing.", scriptedModel([turnAnswer({ next_question: "About prices?" })]).ask)).ok);
    assert.equal((await getInterviewForSession(owner)).finished, false);
  });

  await check("co-founder interview: a key proposal dismissed after the interview ended opens it again, so neither the Interview page nor the Overview says every key fact was covered", async () => {
    const owner = sessionFor(await signUpTestOwner("interview-reopened"));
    const last = KEY_FACT_TOPICS[KEY_FACT_TOPICS.length - 1];
    for (const topic of KEY_FACT_TOPICS.slice(0, -1)) {
      await typeFact(owner, topic, `Known ${topic}`);
    }
    const done = turnAnswer({ proposed_facts: [{ topic: last, value: `Proposed ${last}` }], next_question: "Thank you! Please confirm it.", interview_complete: true });
    assert.ok((await answerLikeThePage(owner, "The last one.", scriptedModel([done]).ask)).ok);
    const finishedOnPages = async () => [(await getInterviewForSession(owner)).finished, (await getCoFounderOverviewForSession(owner)).interviewFinished];
    assert.deepEqual(await finishedOnPages(), [true, true]);

    assert.deepEqual(await dismissProposalForSession(owner, { topic: last, shownProposal: `Proposed ${last}` }), { ok: true });
    assert.deepEqual(await finishedOnPages(), [false, false]);
    assert.deepEqual((await getCoFounderOverviewForSession(owner)).nextSteps.map((step) => step.label), ["Continue the interview"]);
    // Filled in again (here on the Profile page): nothing is missing, so the closing message stands again.
    await typeFact(owner, last, `Known ${last}`);
    assert.deepEqual(await finishedOnPages(), [true, true]);
  });
}
