// The steps of the end-to-end journey (step 43, journey-checks.ts), each
// done the way its page does it, through the real services and /db, with a
// stand-in for Claude, the development stand-in account (posts written to
// .dev-social/) and simulated numbers. Each step checks what it made.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createPhoneLine } from "@/db/phone-lines";
import { getSessionContextFromHeaders, type SessionContext } from "@/lib/session-context";
import { confirmEmailWithPassword } from "@/services/auth";
import { confirmFactForSession, getBusinessProfileForSession } from "@/services/business-profile";
import { generateDraftForSession } from "@/services/content-generation";
import { approveDraftForSession } from "@/services/content-review";
import { createKnowledgeArticleForSession } from "@/services/knowledge";
import { approveKnowledgeArticleForSession } from "@/services/knowledge-status";
import { makeMarketingPlanForSession } from "@/services/marketing-plan";
import { scheduleDraftForSession } from "@/services/publish-scheduling";
import { signUpCompanyOwner } from "@/services/signup";
import { connectStandInAccountForSession } from "@/services/social-connect";
import { ignoreKnownDeviceCookie, logInBrowser, newestVerificationToken, requestHeadersFrom, userIdsWithEmail } from "./account-helpers";
import { answerLikeThePage, modelAnswer, scriptedModel, turnAnswer } from "./cofounder-helpers";
import { draftAnswer, LINKEDIN_POST } from "./content-studio-helpers";
import { runId, testEmail, testPassword } from "./helpers";
import { articleForm, currentRevision } from "./knowledge-helpers";
import { planAnswer, READY_FACTS } from "./marketing-plan-helpers";
import { collectingAfter } from "./media-helpers";
import { jobRowsOfDraft, trackStandInJob } from "./publishing-helpers";
import { connectionRows } from "./social-helpers";

// A word only this run's journey article holds, so searches find it alone.
export const JOURNEY_WORD = `quokka${runId}`;

// Signs a new owner up with the signup form, confirms the address with the
// emailed link and the password, logs in, and returns the session the app
// reads from that browser's cookie.
export async function signUpAndLogIn(label: string): Promise<SessionContext> {
  const email = testEmail(label);
  const browser = requestHeadersFrom(label);
  const signup = { companyName: `Isolation test ${label} ${runId}`, name: "Ana Baker", email, password: testPassword };
  assert.deepEqual(await signUpCompanyOwner(signup, browser), { ok: true });
  const [userId] = await userIdsWithEmail(email);
  const token = await newestVerificationToken(userId);
  assert.deepEqual(await confirmEmailWithPassword({ token, password: testPassword }, browser, ignoreKnownDeviceCookie), { ok: true });
  const session = await getSessionContextFromHeaders(await logInBrowser(email, testPassword, `${label}-browser`));
  assert.ok(session, "logging in gave no session");
  assert.equal(session.role, "owner");
  return session;
}

// One interview answer from which the AI (a stand-in) proposes the facts a
// plan needs; the owner confirms each proposal as the Profile page shows it.
export async function interviewAndConfirmFacts(owner: SessionContext): Promise<void> {
  const proposals = [{ topic: "company_name", value: "Bluebird Bakery" }, ...Object.entries(READY_FACTS).map(([topic, value]) => ({ topic, value }))];
  const model = scriptedModel([turnAnswer({ proposed_facts: proposals, next_question: "Which languages do you speak with customers?" })]);
  const answered = await answerLikeThePage(owner, "We are Bluebird Bakery: sourdough and pastries in Lisbon, for office workers nearby.", model.ask);
  assert.ok(answered.ok, "the interview answer was refused");
  assert.equal(model.requests.length, 1);
  const waiting = (await getBusinessProfileForSession(owner)).completion.proposalsWaiting;
  assert.equal(waiting, proposals.length, "the AI's facts didn't become proposals");
  for (const proposal of proposals) {
    assert.deepEqual(await confirmFactForSession(owner, { topic: proposal.topic, shownProposal: proposal.value, shownConfirmedValue: "" }), { ok: true });
  }
  const { completion } = await getBusinessProfileForSession(owner);
  assert.deepEqual([completion.keyConfirmed, completion.proposalsWaiting], [proposals.length, 0]);
}

// An article written and approved by the owner, for support and marketing:
// its id. It names the products, so the marketing plan's search finds it too.
export async function approvedJourneyArticle(owner: SessionContext): Promise<string> {
  const body = `Refunds for sourdough bread and pastries take 5 business days. ${JOURNEY_WORD}.`;
  const written = await createKnowledgeArticleForSession(owner, articleForm({ title: `How refunds work ${runId}`, body, support: true, marketing: true }));
  assert.ok(written.ok, "the article was refused");
  const approval = { articleId: written.articleId, revision: await currentRevision(owner, written.articleId) };
  assert.deepEqual(await approveKnowledgeArticleForSession(owner, approval), { ok: true });
  return written.articleId;
}

// The phone line ansa's operator links to the company (pnpm link:phone-line).
export async function linkedPhoneLine(session: SessionContext, label: string): Promise<string> {
  return (await createPhoneLine(session.companyId, `pn-${label}-${runId}`)).vapiPhoneNumberId;
}

// A marketing plan from the confirmed facts and the approved marketing
// article (the stand-in for Claude writes it): what Claude was asked.
export async function makeJourneyPlan(owner: SessionContext): Promise<string> {
  const model = scriptedModel([planAnswer()]);
  const made = await makeMarketingPlanForSession(owner, { goalNote: "More weekday lunch customers" }, model.ask);
  assert.deepEqual(made, { ok: true, version: 1 });
  return model.requests[0].prompt;
}

// A LinkedIn text post the AI (a stand-in) writes, approved by the owner
// after checking its claims: its id, and what Claude was asked.
export async function approvedJourneyDraft(owner: SessionContext, topic: string): Promise<{ draftId: string; prompt: string }> {
  const model = scriptedModel([draftAnswer({ body: `${topic}: fresh sourdough every morning, baked in Lisbon.` })]);
  const made = await generateDraftForSession(owner, { ...LINKEDIN_POST, topic, pillar: "Lunch ideas", campaign: "Lunch week" }, model.ask);
  assert.ok(made.ok, "the AI's draft was refused");
  assert.deepEqual(await approveDraftForSession(owner, { draftId: made.draftId, version: "1", claimsChecked: "on" }), { ok: true });
  return { draftId: made.draftId, prompt: model.requests[0].prompt };
}

// The company's LinkedIn stand-in account, connected by the owner: its id.
export async function connectedStandIn(owner: SessionContext): Promise<string> {
  assert.deepEqual(await connectStandInAccountForSession(owner, { platform: "linkedin" }), { ok: true });
  const account = (await connectionRows(owner.companyId)).find((row) => row.isStandIn && row.platform === "linkedin");
  assert.ok(account, "no stand-in account");
  return account.id;
}

// Schedules the approved draft for now on the account, as its page does;
// the run after the answer publishes it to .dev-social/. The job's id, the
// stand-in's file (under .dev-social/) and what it wrote.
export async function publishNow(owner: SessionContext, draftId: string, accountId: string): Promise<{ jobId: string; file: string; written: string }> {
  const after = collectingAfter();
  const input = { draftId, version: "1", connectionIds: [accountId], when: "now", scheduledFor: "", withoutApproval: null };
  assert.deepEqual(await scheduleDraftForSession(owner, input, after.run), { ok: true });
  await after.settle();
  const [job] = await jobRowsOfDraft(draftId);
  assert.equal(job?.status, "published", "the runner didn't publish the post");
  const fileName = await trackStandInJob(job.id);
  assert.ok(fileName, "the stand-in wrote no file");
  const file = path.join("linkedin", fileName);
  return { jobId: job.id, file, written: await readFile(path.join(process.cwd(), ".dev-social", file), "utf8") };
}

// A performance review answer citing the numbers of the first and the
// fifth post (labels P1 and P5, in the order they went out).
export function reviewAnswer(firstViews: number, fifthReactions: number) {
  return modelAnswer({
    findings: [
      { text: "P5 got the most reactions of the period.", evidence: [{ post_label: "P5", group: "", metric: "reactions", value: fifthReactions }] },
      { text: "P1 had the fewest views.", evidence: [{ post_label: "P1", group: "", metric: "views", value: firstViews }] },
    ],
    recommendations: [{ text: "Write more posts like P5.", based_on_findings: [1] }],
    limits_of_this_data: ["Only 5 posts had numbers in this period."],
  });
}
