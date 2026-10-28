// Shared pieces for the Co-Founder checks (step 36): a stand-in for Claude
// that answers interview turns and suggestions, answering the interview the
// way its page does, and what the database holds for a company's business
// profile and interview.

import assert from "node:assert/strict";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { businessFacts, onboardingMessages } from "@/db/schema";
import type { BusinessFactTopic } from "@/lib/business-facts";
import type { FactProposal } from "@/lib/cofounder/fact-proposals";
import type { FormErrors } from "@/lib/form-result";
import type { ModelAsker, ModelRequest, ModelResult } from "@/lib/model-request";
import type { SessionContext } from "@/lib/session";
import { saveFactForSession } from "@/services/business-profile";
import { answerInterviewForSession, getInterviewForSession, type InterviewAnswerResult } from "@/services/onboarding-interview";

// A Claude answer whose text is this value as JSON.
export function modelAnswer(json: unknown): ModelResult {
  return { kind: "ok", outputText: JSON.stringify(json), usage: { inputTokens: 1, outputTokens: 1 } };
}

type TurnFields = { proposed_facts?: unknown[]; next_question?: string; interview_complete?: boolean };

// One interview turn as Claude writes it; fields left out get a plain default.
export function turnAnswer(turn: TurnFields): ModelResult {
  return modelAnswer({ proposed_facts: [], next_question: "What else should I know?", interview_complete: false, ...turn });
}

// A stand-in for adapters/claude.ts: gives these answers in order (the last
// one again once they run out) and records every request. `beforeAnswer`
// runs inside each request, to change something while "Claude" thinks.
export function scriptedModel(replies: ModelResult[], beforeAnswer?: () => Promise<void>) {
  const fake = { requests: [] as ModelRequest[], ask: (async () => replies[0]) as ModelAsker };
  fake.ask = async (request) => {
    fake.requests.push(request);
    if (beforeAnswer) {
      await beforeAnswer();
    }
    return replies[Math.min(fake.requests.length - 1, replies.length - 1)];
  };
  return fake;
}

// Answers the interview as its page does: while the page shows the first
// question, the form also names the topic it asked about.
export async function answerLikeThePage(session: SessionContext, answer: string, ask: ModelAsker): Promise<InterviewAnswerResult> {
  const page = await getInterviewForSession(session);
  const openingTopic = page.opening ? (page.opening.topic ?? "none") : undefined;
  return answerInterviewForSession(session, { answer, openingTopic }, ask);
}

// One interview answer whose reply (from the stand-in) proposes these facts.
export async function proposeInInterview(owner: SessionContext, proposals: FactProposal[]): Promise<void> {
  const model = scriptedModel([turnAnswer({ proposed_facts: proposals, next_question: "And what else?" })]);
  const result = await answerLikeThePage(owner, "Here is what we do.", model.ask);
  assert.ok(result.ok, messageOf(result));
}

// The error message of a refused form, or a marker when it worked.
export function messageOf(result: { ok: true } | { ok: false; errors: FormErrors }): string {
  return result.ok ? "(it worked)" : (result.errors.message ?? JSON.stringify(result.errors.fieldErrors));
}

// Types an owner's own value for a topic, as the Profile page's editor does.
export async function typeFact(owner: SessionContext, topic: BusinessFactTopic, value: string): Promise<void> {
  const current = await factRow(owner.companyId, topic);
  const result = await saveFactForSession(owner, { topic, value, originalValue: current?.confirmedValue ?? "" });
  assert.deepEqual(result, { ok: true });
}

// One topic of a company's profile as the database holds it (undefined: no row).
export async function factRow(companyId: string, topic: BusinessFactTopic) {
  const [row] = await db
    .select()
    .from(businessFacts)
    .where(and(eq(businessFacts.companyId, companyId), eq(businessFacts.topic, topic)));
  return row;
}

// Every row of a company's profile.
export async function factRows(companyId: string) {
  return db.select().from(businessFacts).where(eq(businessFacts.companyId, companyId));
}

// A company's interview messages as stored, oldest first.
export async function messageRows(companyId: string) {
  return db
    .select()
    .from(onboardingMessages)
    .where(eq(onboardingMessages.companyId, companyId))
    .orderBy(asc(onboardingMessages.createdAt), asc(onboardingMessages.id));
}

// The interview as its page shows it: who wrote each message, and its text.
export async function shownConversation(session: SessionContext): Promise<[string, string | null][]> {
  const page = await getInterviewForSession(session);
  return page.messages.map((message) => [message.author, message.text]);
}
