// Step 27, work after the webhook that never finished: the scheduled job
// finds emails and calls whose run was cut off (and only those), least
// recently tried first, and runs them again through their company's own path,
// emails and calls taking turns, starting one only while its slowest run still
// fits in the job's 300 seconds (counted from before the cleanup); the Calls
// list shows a stale analysis as stuck; the routes and pages that wait for
// Claude may run 300 seconds; and the Vapi per-IP limit sits far above any
// real peak.
// FAKE fetcher and model, and only this check's own rows are run: a local
// database may hold real stuck rows, which must never meet a fake.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { createPhoneLine } from "@/db/phone-lines";
import { calls, inboundEmails } from "@/db/schema";
import { CALL_DECISION_SETTINGS, EMAIL_TRIAGE_SETTINGS } from "@/adapters/claude-settings";
import { RECEIVING_TIMING, SEND_TIMEOUT_MS } from "@/adapters/resend";
import { EMAIL_TRIAGE_SYSTEM_PROMPT } from "@/lib/email-triage/prompt";
import type { ModelAsker } from "@/lib/model-request";
import { listCallsForSession } from "@/services/calls";
import { handleCleanupRequest } from "@/services/maintenance";
import { RATE_LIMITS } from "@/services/rate-limit";
import { findStuckWork, JOB_MAX_DURATION_MS, LONGEST_CALL_MS, LONGEST_EMAIL_MS, runStuckWork } from "@/services/stuck-work";
import { SOLVED_TRANSCRIPT } from "./brain-guard-checks";
import { saveTestCall } from "./brain-test-calls";
import { check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { inboundRow, receiveEmailRow, resendContent } from "./inbound-helpers";

// Older than anything real, so these rows are always in the job's
// least-recently-tried-first batch.
const LONG_AGO = new Date("2000-01-01T00:00:00Z");
const daysAfterLongAgo = (days: number) => new Date(LONG_AGO.getTime() + days * 24 * 60 * 60 * 1000);

// No API key: an email gets the fallback triage, a call a rule escalation.
const modelWithoutKey: ModelAsker = async () => ({ kind: "unavailable" });

async function callRow(callId: string) {
  const [row] = await db.select().from(calls).where(eq(calls.id, callId));
  return row;
}

export async function runStuckWorkChecks() {
  const owner = await signUpTestOwner("stuck-work");
  const line = await createPhoneLine(owner.companyId, `pn-stuck-${runId}`);

  await check("stuck work: the job finds emails and calls whose run was cut off, never fresh ones, and runs them through their own path", async () => {
    const stuckEmail = await receiveEmailRow(owner, "job-email");
    await db.update(inboundEmails).set({ receivedAt: LONG_AGO }).where(eq(inboundEmails.id, stuckEmail));
    const freshEmail = await receiveEmailRow(owner, "job-fresh");
    const stuckCall = await saveTestCall(line.vapiPhoneNumberId, SOLVED_TRANSCRIPT);
    await db.update(calls).set({ createdAt: LONG_AGO }).where(eq(calls.id, stuckCall));
    const freshCall = await saveTestCall(line.vapiPhoneNumberId, SOLVED_TRANSCRIPT);
    const work = await findStuckWork();
    assert.ok(work.emails.some((item) => item.id === stuckEmail && item.companyId === owner.companyId), "the stuck email was not found");
    assert.ok(work.calls.some((item) => item.id === stuckCall && item.companyId === owner.companyId), "the stuck call was not found");
    assert.ok(!work.emails.some((item) => item.id === freshEmail) && !work.calls.some((item) => item.id === freshCall), "fresh work was taken for stuck");
    const ownWork = { emails: work.emails.filter((item) => item.id === stuckEmail), calls: work.calls.filter((item) => item.id === stuckCall), generations: [] };
    const counts = await runStuckWork(ownWork, { fetchEmail: async () => resendContent("job-email"), askModel: modelWithoutKey });
    assert.deepEqual(counts, { emails: 1, calls: 1, generations: 0 });
    assert.equal((await inboundRow(stuckEmail)).status, "ticketed");
    const decided = await callRow(stuckCall);
    assert.deepEqual([decided.analysisStatus, decided.aiReasonCode], ["decided", "model_unavailable"]);
  });

  await check("stuck work: an analysis cut off long ago is found and finished; one running right now is left alone", async () => {
    const stale = await saveTestCall(line.vapiPhoneNumberId, SOLVED_TRANSCRIPT);
    await db.update(calls).set({ analysisStatus: "analyzing", analysisStartedAt: LONG_AGO, createdAt: LONG_AGO }).where(eq(calls.id, stale));
    const running = await saveTestCall(line.vapiPhoneNumberId, SOLVED_TRANSCRIPT);
    await db.update(calls).set({ analysisStatus: "analyzing", analysisStartedAt: new Date() }).where(eq(calls.id, running));
    const work = await findStuckWork();
    assert.ok(work.calls.some((item) => item.id === stale) && !work.calls.some((item) => item.id === running));
    // Even when handed to the job, a running analysis is not claimed again.
    const both = [stale, running].map((id) => ({ companyId: owner.companyId, id }));
    await runStuckWork({ emails: [], calls: both, generations: [] }, { askModel: modelWithoutKey });
    assert.equal((await callRow(stale)).analysisStatus, "decided");
    assert.equal((await callRow(running)).analysisStatus, "analyzing");
  });

  await check("stuck work: what was tried least recently goes first (a row cut off again goes to the back), and emails and calls take turns", async () => {
    // Arrived first, but its last run started after the other one arrived.
    const retriedEmail = await receiveEmailRow(owner, "job-retried");
    await db.update(inboundEmails).set({ status: "processing", receivedAt: LONG_AGO, processingStartedAt: daysAfterLongAgo(2) }).where(eq(inboundEmails.id, retriedEmail));
    const waitingEmail = await receiveEmailRow(owner, "job-waiting");
    await db.update(inboundEmails).set({ receivedAt: daysAfterLongAgo(1) }).where(eq(inboundEmails.id, waitingEmail));
    const retriedCall = await saveTestCall(line.vapiPhoneNumberId, SOLVED_TRANSCRIPT);
    await db.update(calls).set({ analysisStatus: "analyzing", createdAt: LONG_AGO, analysisStartedAt: daysAfterLongAgo(2) }).where(eq(calls.id, retriedCall));
    const waitingCall = await saveTestCall(line.vapiPhoneNumberId, SOLVED_TRANSCRIPT);
    await db.update(calls).set({ createdAt: daysAfterLongAgo(1) }).where(eq(calls.id, waitingCall));
    const work = await findStuckWork();
    const ownEmails = work.emails.filter((item) => item.id === retriedEmail || item.id === waitingEmail);
    const ownCalls = work.calls.filter((item) => item.id === retriedCall || item.id === waitingCall);
    assert.deepEqual([ownEmails.map((item) => item.id), ownCalls.map((item) => item.id)], [[waitingEmail, retriedEmail], [waitingCall, retriedCall]]);
    const asked: string[] = [];
    const recordingModel: ModelAsker = async (request) => {
      asked.push(request.systemPrompt === EMAIL_TRIAGE_SYSTEM_PROMPT ? "email" : "call");
      return { kind: "unavailable" };
    };
    const counts = await runStuckWork({ emails: ownEmails, calls: ownCalls, generations: [] }, { fetchEmail: async () => resendContent("job-turns"), askModel: recordingModel });
    assert.deepEqual([counts, asked], [{ emails: 2, calls: 2, generations: 0 }, ["email", "call", "email", "call"]]);
  });

  await check("stuck work: an email or call is only started while its slowest run still fits in the job's 300 seconds", async () => {
    // Derived from the real limits: every Claude attempt and Resend fetch timing out, then the assignment email.
    const allAttemptsMs = (settings: { timeoutMs: number; maxRetries: number }) => settings.timeoutMs * (settings.maxRetries + 1);
    assert.ok(LONGEST_CALL_MS >= allAttemptsMs(CALL_DECISION_SETTINGS) + SEND_TIMEOUT_MS, `${LONGEST_CALL_MS} ms`);
    assert.ok(LONGEST_EMAIL_MS >= RECEIVING_TIMING.timeoutMs * 3 + allAttemptsMs(EMAIL_TRIAGE_SETTINGS) + SEND_TIMEOUT_MS, `${LONGEST_EMAIL_MS} ms`);
    assert.ok(LONGEST_EMAIL_MS < LONGEST_CALL_MS && LONGEST_CALL_MS < JOB_MAX_DURATION_MS);
    const route = await readFile(path.join(process.cwd(), "app/api/cron/cleanup/route.ts"), "utf8");
    assert.match(route, new RegExp(`^export const maxDuration = ${JOB_MAX_DURATION_MS / 1000};$`, "m"));

    const email = await receiveEmailRow(owner, "job-late");
    const call = await saveTestCall(line.vapiPhoneNumberId, SOLVED_TRANSCRIPT);
    const work = { emails: [{ companyId: owner.companyId, id: email }], calls: [{ companyId: owner.companyId, id: call }], generations: [] };
    const fakes = { fetchEmail: async () => resendContent("job-late"), askModel: modelWithoutKey };
    const startedWithTimeLeft = (leftMs: number) => Date.now() - (JOB_MAX_DURATION_MS - leftMs);
    // Too little left for anything: nothing starts.
    assert.deepEqual(await runStuckWork(work, fakes, startedWithTimeLeft(LONGEST_EMAIL_MS - 1_000)), { emails: 0, calls: 0, generations: 0 });
    // Enough for an email, not for a call.
    assert.deepEqual(await runStuckWork(work, fakes, startedWithTimeLeft((LONGEST_EMAIL_MS + LONGEST_CALL_MS) / 2)), { emails: 1, calls: 0, generations: 0 });
    assert.deepEqual([(await inboundRow(email)).status, (await callRow(call)).analysisStatus], ["ticketed", "pending"]);
    assert.deepEqual(await runStuckWork({ emails: [], calls: work.calls, generations: [] }, fakes, Date.now()), { emails: 0, calls: 1, generations: 0 });
    assert.equal((await callRow(call)).analysisStatus, "decided");
  });

  await check("stuck work: the job's clock starts before its cleanup, so the cleanup's time counts against the 300 seconds", async () => {
    const secret = `cron-secret-${runId}-clock`;
    const slowCleanup = async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { rateLimitCounters: 0, sessions: 0, verifications: 0, oauthStates: 0 };
    };
    const seen = { jobStartedAt: 0, recoveryStartedAt: 0 };
    const recover = async (jobStartedAt: number) => {
      Object.assign(seen, { jobStartedAt, recoveryStartedAt: Date.now() });
      return { emails: 0, calls: 0, generations: 0 };
    };
    const headers = { authorization: `Bearer ${secret}`, "x-forwarded-for": `isolation-${runId}-cron-clock` };
    const noPublishing = async () => ({ interrupted: 0, published: 0, failed: 0, needsAttention: 0, requeued: 0 });
    const noMetrics = async () => ({ collected: 0, failed: 0, skipped: 0 });
    const answer = await handleCleanupRequest(new Request("http://localhost/api/cron/cleanup", { headers }), secret, recover, slowCleanup, noPublishing, noMetrics);
    assert.equal(answer.status, 200);
    assert.ok(seen.recoveryStartedAt - seen.jobStartedAt >= 200, `the clock started ${seen.recoveryStartedAt - seen.jobStartedAt} ms before the recovery`);
  });

  await check("stuck work: the Calls list shows a call never analyzed 5+ minutes after it came in as stuck, a fresh one as not", async () => {
    const stale = await saveTestCall(line.vapiPhoneNumberId, SOLVED_TRANSCRIPT);
    await db.update(calls).set({ createdAt: new Date(Date.now() - 10 * 60 * 1000) }).where(eq(calls.id, stale));
    const fresh = await saveTestCall(line.vapiPhoneNumberId, SOLVED_TRANSCRIPT);
    const listed = await listCallsForSession(sessionFor(owner));
    assert.equal(listed.find((call) => call.id === stale)?.analysisStuck, true);
    assert.equal(listed.find((call) => call.id === fresh)?.analysisStuck, false);
  });

  await check("time budgets: the webhooks, the scheduled jobs, the pages that ask Claude (the Analytics page's review too) and the pages whose images are made, or posts sent, after their answer may run 300 seconds; the Vapi limit is far above any peak", async () => {
    const files = [
      "app/api/webhooks/vapi/route.ts",
      "app/api/webhooks/resend/route.ts",
      "app/api/cron/cleanup/route.ts",
      "app/api/cron/publish/route.ts",
      "app/calls/[callId]/page.tsx",
      "app/emails/page.tsx",
      "app/cofounder/interview/page.tsx",
      "app/cofounder/profile/page.tsx",
      "app/cofounder/strategy/page.tsx",
      "app/cofounder/studio/new/page.tsx",
      "app/cofounder/studio/[draftId]/page.tsx",
      "app/cofounder/media/page.tsx",
      "app/cofounder/calendar/page.tsx",
      "app/cofounder/queue/page.tsx",
      "app/cofounder/analytics/page.tsx",
    ];
    for (const file of files) {
      assert.match(await readFile(path.join(process.cwd(), file), "utf8"), /^export const maxDuration = 300;$/m, file);
    }
    assert.ok(RATE_LIMITS.vapiWebhookPerIp.maxAttempts >= 10_000, "a busy hour of chatter events could drop calls");
  });
}
