// After the end-to-end journey (journey-checks.ts): a member of another
// company reads none of what the journey made on any page's service, and
// that company's owner changes none of it; then the journey's owner
// deletes what owners can delete (step 43, retention and deletion), while
// the posts that went out stay where they went (and on the Analytics page).

import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import { NOTHING_FOUND_ANSWER } from "@/lib/knowledge/call-answer";
import { getAnalyticsPageForSession } from "@/services/analytics-page";
import { getBusinessOverviewForSession } from "@/services/business-overview";
import { getBusinessProfileForSession } from "@/services/business-profile";
import { getCoFounderOverviewForSession } from "@/services/cofounder-overview";
import { getContentDraftPageForSession, listContentDraftsForSession } from "@/services/content-drafts";
import { approveDraftForSession, archiveDraftForSession } from "@/services/content-review";
import { getKnowledgeArticleForSession, listKnowledgeArticlesForSession } from "@/services/knowledge";
import { testKnowledgeSearchForSession } from "@/services/knowledge-search";
import { deleteKnowledgeArticleForSession } from "@/services/knowledge-status";
import { getStrategyPageForSession } from "@/services/marketing-strategy";
import { deleteMediaForSession } from "@/services/media-deletion";
import { getInterviewForSession, startOverInterviewForSession } from "@/services/onboarding-interview";
import { getCalendarPageForSession, getQueuePageForSession } from "@/services/publishing-pages";
import { getSocialAccountsPageForSession } from "@/services/social-accounts";
import { disconnectSocialAccountForSession } from "@/services/social-disconnect";
import { generatedDraftId, LINKEDIN_POST } from "./content-studio-helpers";
import { addTeammate, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import type { Journey } from "./journey-checks";
import { JOURNEY_WORD, linkedPhoneLine } from "./journey-steps";
import { assetRow, collectingAfter, storedFiles, uploadedAssetId } from "./media-helpers";
import { jobRow, schedule } from "./publishing-helpers";
import { connectionRows } from "./social-helpers";
import { searchDuringCall } from "./vapi-tool-helpers";

const question = { question: `how long does a refund take ${JOURNEY_WORD}` };

export async function runJourneyIsolationChecks(journey: Journey | null) {
  await check("journey: a member of another company finds none of it (profile, interview, knowledge and its search, the phone tool on their line, plan, drafts, accounts, queue, calendar, analytics, review, the dashboard's overview, the Overview's checklist), and that company's owner can't approve, schedule, delete or disconnect any of it", async () => {
    assert.ok(journey, "the journey above didn't finish");
    const otherOwnerUser = await signUpTestOwner("journey-other");
    const otherOwner = sessionFor(otherOwnerUser);
    const member = sessionFor(await addTeammate(otherOwnerUser, "journey-other-member", "member"));
    const { completion } = await getBusinessProfileForSession(member);
    assert.deepEqual([completion.keyConfirmed, completion.proposalsWaiting], [0, 0]);
    assert.equal((await getInterviewForSession(member)).messages.length, 0);
    assert.deepEqual(await listKnowledgeArticlesForSession(member), []);
    assert.equal(await getKnowledgeArticleForSession(member, journey.articleId), null);
    const searched = await testKnowledgeSearchForSession(member, question);
    assert.ok(searched.ok && searched.slice.hits.length === 0 && searched.callAnswer === NOTHING_FOUND_ANSWER);
    const theirLine = await linkedPhoneLine(otherOwner, "journey-other");
    assert.equal((await searchDuringCall(theirLine, `call-journey-other-${runId}`, `refund ${JOURNEY_WORD}`)).result, NOTHING_FOUND_ANSWER);
    const strategy = await getStrategyPageForSession(member);
    assert.deepEqual([strategy.current, strategy.newestVersion], [null, 0]);
    assert.deepEqual(await listContentDraftsForSession(member, 1, { status: "current", platform: "all" }), []);
    for (const draftId of journey.draftIds) {
      assert.equal(await getContentDraftPageForSession(member, draftId), null);
    }
    const accounts = await getSocialAccountsPageForSession(member);
    assert.ok(accounts.platforms.every((platform) => platform.connections.length === 0 && platform.disconnected.length === 0));
    const queue = await getQueuePageForSession(member);
    assert.deepEqual([queue.waiting, queue.published, queue.failed, queue.needsAttention, queue.canceled, queue.activity], [[], [], [], [], [], []]);
    assert.deepEqual((await getCalendarPageForSession(member)).items, []);
    const analytics = await getAnalyticsPageForSession(member, {});
    assert.deepEqual([analytics.postCount, analytics.totals, analytics.review], [0, [], null]);
    assert.equal((await getBusinessOverviewForSession(member)).cofounder, null);
    assert.ok((await getCoFounderOverviewForSession(member)).checklist.every((step) => !step.done));

    // Their owner, with the journey's own ids, changes nothing.
    assert.equal((await approveDraftForSession(otherOwner, { draftId: journey.draftIds[0], version: "1", claimsChecked: "on" })).ok, false);
    const { result } = await schedule(otherOwner, journey.draftIds[0], [journey.accountId]);
    assert.equal(result.ok, false);
    assert.equal((await deleteKnowledgeArticleForSession(otherOwner, { articleId: journey.articleId })).ok, false);
    assert.equal((await disconnectSocialAccountForSession(otherOwner, { connectionId: journey.accountId }, collectingAfter().run)).ok, false);
    assert.ok(await getKnowledgeArticleForSession(journey.owner, journey.articleId), "the article went");
    assert.equal((await connectionRows(journey.owner.companyId)).find((row) => row.id === journey.accountId)?.status, "connected");
  });
}

export async function runJourneyRetentionChecks(journey: Journey | null) {
  await check("journey: owners delete knowledge articles, clear the interview, archive drafts, delete media and disconnect accounts (tokens deleted); the posts that went out stay published, on the platform (the stand-in's files) and on the Analytics page", async () => {
    assert.ok(journey, "the journey above didn't finish");
    const { owner } = journey;
    assert.deepEqual(await deleteKnowledgeArticleForSession(owner, { articleId: journey.articleId }), { ok: true });
    assert.equal(await getKnowledgeArticleForSession(owner, journey.articleId), null);
    assert.equal((await searchDuringCall(journey.line, `call-journey-after-${runId}`, `refund ${JOURNEY_WORD}`)).result, NOTHING_FOUND_ANSWER);
    assert.deepEqual((await getStrategyPageForSession(owner)).current?.knowledgeUsed, [{ articleId: journey.articleId, title: null }]);

    assert.deepEqual(await startOverInterviewForSession(owner), { ok: true });
    assert.equal((await getInterviewForSession(owner)).messages.length, 0);
    assert.equal((await getBusinessProfileForSession(owner)).completion.keyConfirmed, 4, "clearing the interview took the facts too");

    const unpublished = await generatedDraftId(owner, { ...LINKEDIN_POST, topic: `Not sent ${runId}` });
    assert.deepEqual(await archiveDraftForSession(owner, { draftId: unpublished }), { ok: true });
    assert.equal((await getContentDraftPageForSession(owner, unpublished))?.status, "archived");
    // A post that went out stays as it went out.
    assert.equal((await archiveDraftForSession(owner, { draftId: journey.draftIds[0] })).ok, false);
    assert.equal((await getContentDraftPageForSession(owner, journey.draftIds[0]))?.status, "published");

    const assetId = await uploadedAssetId(owner);
    assert.deepEqual(await deleteMediaForSession(owner, { assetId }), { ok: true });
    assert.equal(await assetRow(assetId), undefined);
    assert.deepEqual(await storedFiles(owner.companyId), []);

    assert.deepEqual(await disconnectSocialAccountForSession(owner, { connectionId: journey.accountId }, collectingAfter().run), { ok: true });
    const account = (await connectionRows(owner.companyId)).find((row) => row.id === journey.accountId);
    assert.deepEqual([account?.status, account?.accessTokenEncrypted, account?.refreshTokenEncrypted], ["disconnected", null, null]);

    for (const jobId of journey.jobIds) {
      const job = await jobRow(jobId);
      assert.deepEqual([job.status, job.externalPostId?.startsWith("dev-")], ["published", true]);
    }
    for (const file of journey.postFiles) {
      await access(path.join(process.cwd(), ".dev-social", file));
    }
    assert.equal((await getAnalyticsPageForSession(owner, {})).postCount, journey.jobIds.length);
  });
}
