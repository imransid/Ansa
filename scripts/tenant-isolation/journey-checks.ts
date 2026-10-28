// End-to-end journey checks (step 43): one new company goes the whole way,
// through the services the pages call, with a stand-in for Claude, the
// development stand-in account and simulated numbers (journey-steps.ts):
// signup -> interview -> confirmed facts -> approved knowledge -> the support
// search and the phone assistant's tool -> a marketing plan -> a draft ->
// approval -> an account -> a post published -> numbers -> analytics -> a
// checked review. Then a member of another company finds none of it, and
// the owner deletes what owners delete while the published posts stay.

import assert from "node:assert/strict";
import { CALL_ANSWER_PREFIX } from "@/lib/knowledge/call-answer";
import type { SessionContext } from "@/lib/session";
import { getAnalyticsPageForSession } from "@/services/analytics-page";
import { getBusinessOverviewForSession } from "@/services/business-overview";
import { getCoFounderOverviewForSession } from "@/services/cofounder-overview";
import { getContentDraftPageForSession } from "@/services/content-drafts";
import { testKnowledgeSearchForSession } from "@/services/knowledge-search";
import { getStrategyPageForSession } from "@/services/marketing-strategy";
import { reviewPerformanceForSession } from "@/services/performance-review";
import { check, runId } from "./helpers";
import { runJourneyIsolationChecks, runJourneyRetentionChecks } from "./journey-after-checks";
import {
  approvedJourneyArticle,
  approvedJourneyDraft,
  connectedStandIn,
  interviewAndConfirmFacts,
  JOURNEY_WORD,
  linkedPhoneLine,
  makeJourneyPlan,
  publishNow,
  reviewAnswer,
  signUpAndLogIn,
} from "./journey-steps";
import { simulated } from "./analytics-helpers";
import { scriptedModel } from "./cofounder-helpers";
import { READY_FACTS } from "./marketing-plan-helpers";
import { searchDuringCall } from "./vapi-tool-helpers";

// What the journey made, for the checks after it.
export type Journey = {
  owner: SessionContext;
  articleId: string;
  line: string;
  draftIds: string[];
  jobIds: string[];
  // The posts as the stand-in wrote them, under .dev-social/.
  postFiles: string[];
  accountId: string;
};

// The five posts: the first goes through every step on its own, the other
// four make enough posts with numbers for a review (5 at least).
const POST_NUMBERS = [
  { views: 100, reactions: 4 },
  { views: 110, reactions: 5 },
  { views: 120, reactions: 6 },
  { views: 130, reactions: 7 },
  { views: 140, reactions: 8 },
];

export async function runJourneyChecks() {
  let journey: Journey | null = null;
  await check("journey: an owner signs up and confirms the address; the interview proposes facts and the owner confirms them; an approved article is found by the support search and by the phone assistant's tool; a marketing plan is made from the facts and the article; the AI's draft is approved, a stand-in account connected, the post scheduled for now and published to .dev-social/; simulated numbers add up on Analytics; a review cites them, checked; the dashboard and the Overview follow along", async () => {
    const owner = await signUpAndLogIn("journey");
    await interviewAndConfirmFacts(owner);
    const articleId = await approvedJourneyArticle(owner);
    const searched = await testKnowledgeSearchForSession(owner, { question: `how long does a refund take ${JOURNEY_WORD}` });
    assert.ok(searched.ok && searched.slice.hits.some((hit) => hit.title === `How refunds work ${runId}`), "the support search didn't find the article");
    const line = await linkedPhoneLine(owner, "journey");
    const toolAnswer = String((await searchDuringCall(line, `call-journey-${runId}`, `refund ${JOURNEY_WORD}`)).result);
    assert.ok(toolAnswer.startsWith(CALL_ANSWER_PREFIX), "the tool's answer has no reference-text label");
    assert.ok(toolAnswer.includes(`<article title="How refunds work ${runId}">Refunds for sourdough bread`), "the phone assistant didn't get the article");

    const planPrompt = await makeJourneyPlan(owner);
    assert.ok(planPrompt.includes(READY_FACTS.description) && planPrompt.includes(`How refunds work ${runId}`), "the plan wasn't made from the facts and the article");
    assert.deepEqual((await getStrategyPageForSession(owner)).current?.knowledgeUsed.map((used) => used.articleId), [articleId]);

    const accountId = await connectedStandIn(owner);
    const draftIds: string[] = [];
    const jobIds: string[] = [];
    const postFiles: string[] = [];
    for (const [index, numbers] of POST_NUMBERS.entries()) {
      const topic = `Lunch menu ${index + 1} ${runId}`;
      const { draftId, prompt } = await approvedJourneyDraft(owner, topic);
      assert.ok(prompt.includes(READY_FACTS.description) && prompt.includes("Lunch ideas"), "the draft wasn't written from the facts and the plan");
      const { jobId, file, written } = await publishNow(owner, draftId, accountId);
      assert.ok(written.includes(`${topic}: fresh sourdough every morning`), "the stand-in's file doesn't hold the post");
      assert.equal((await getContentDraftPageForSession(owner, draftId))?.status, "published");
      await simulated(jobId, [`views=${numbers.views}`, `reactions=${numbers.reactions}`]);
      draftIds.push(draftId);
      jobIds.push(jobId);
      postFiles.push(file);
    }

    const analytics = await getAnalyticsPageForSession(owner, {});
    assert.deepEqual([analytics.postCount, analytics.postsWithNumbers, analytics.postsNeededForReview], [5, 5, 0]);
    const [linkedIn] = analytics.totals;
    assert.deepEqual([linkedIn.platform, linkedIn.metrics.views, linkedIn.metrics.reactions], [
      "linkedin",
      { kind: "total", value: 600, posts: 5 },
      { kind: "total", value: 30, posts: 5 },
    ]);
    const model = scriptedModel([reviewAnswer(POST_NUMBERS[0].views, POST_NUMBERS[4].reactions)]);
    assert.deepEqual(await reviewPerformanceForSession(owner, { period: "30", timeZone: "Europe/Lisbon" }, model.ask), { ok: true });
    const review = (await getAnalyticsPageForSession(owner, {})).review;
    assert.deepEqual(
      review?.findings.map((finding) => finding.evidence.map((evidence) => [evidence.source.split(":")[0], evidence.metric, evidence.value, evidence.simulated])),
      [[["P5", "Reactions", "8", true]], [["P1", "Impressions", "100", true]]],
    );

    const overview = await getBusinessOverviewForSession(owner);
    assert.deepEqual(overview.cofounder, {
      keyFactsConfirmed: 4,
      keyFactsTotal: 16,
      draftsWaitingForApproval: 0,
      postsScheduledNextWeek: 0,
      postsNeedingAttention: 0,
      postsFailedLastWeek: 0,
      accountsNeedingReconnect: 0,
    });
    const { checklist } = await getCoFounderOverviewForSession(owner);
    assert.deepEqual(
      checklist.map((step) => [step.key, step.done]),
      [
        ["interview", false],
        ["key_facts", false],
        ["plan", true],
        ["first_draft", true],
        ["account", true],
        ["first_post", true],
        ["metrics", true],
      ],
    );
    journey = { owner, articleId, line, draftIds, jobIds, postFiles, accountId };
  });

  await runJourneyIsolationChecks(journey);
  await runJourneyRetentionChecks(journey);
}
