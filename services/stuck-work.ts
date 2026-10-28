import "server-only";
import { CALL_DECISION_SETTINGS, EMAIL_TRIAGE_SETTINGS, longestRequestMs } from "@/adapters/claude-settings";
import { longestReceivingFetchMs, SEND_TIMEOUT_MS } from "@/adapters/resend";
import { findStuckCalls, findStuckGenerationJobs, findStuckInboundEmails, type StuckItem } from "@/db/stuck-work";
import type { InboundEmailContent } from "@/lib/inbound-email";
import type { ModelAsker } from "@/lib/model-request";
import { analyzeCall } from "./call-analysis";
import { processInboundEmail } from "./inbound-email-processing";
import { LONGEST_GENERATION_MS, runGenerationJob, type GenerationRunOptions } from "./media-generation-runs";

// How many unfinished emails, calls and image or video requests one run
// looks at. Whatever is left (or cut off) is picked up by the next run.
const BATCH_SIZE = 25;

// The scheduled route's maxDuration (app/api/cron/cleanup/route.ts, where
// Next.js needs it written as a plain number). Counted from the start of the
// whole job, cleanup included: the host cuts the request off there.
export const JOB_MAX_DURATION_MS = 300_000;

// Room for one item's own database work: a query may wait up to 10 seconds
// for a free connection (db/client.ts).
const DATABASE_ALLOWANCE_MS = 10_000;

// The longest one item can take when everything is slow: every Claude attempt
// runs out of time (for an email, after every try of fetching it from Resend),
// then whoever the ticket lands on is emailed. An item is only started when
// this still fits before the job is cut off, so none is killed half-way (its
// paid Claude work lost, and the row left "analyzing" until the next run).
export const LONGEST_CALL_MS = longestRequestMs(CALL_DECISION_SETTINGS) + SEND_TIMEOUT_MS + DATABASE_ALLOWANCE_MS;
export const LONGEST_EMAIL_MS = longestReceivingFetchMs() + longestRequestMs(EMAIL_TRIAGE_SETTINGS) + SEND_TIMEOUT_MS + DATABASE_ALLOWANCE_MS;

export type StuckWork = { emails: StuckItem[]; calls: StuckItem[]; generations: StuckItem[] };
export type RecoveryCounts = { emails: number; calls: number; generations: number };

// Only the checks replace these, with fakes.
export type RecoveryOptions = {
  fetchEmail?: (resendEmailId: string) => Promise<InboundEmailContent | null>;
  askModel?: ModelAsker;
  generation?: GenerationRunOptions;
};

// Runs again the emails and calls whose work after the webhook never
// finished (a crash, a deploy, a time limit), and the image or video
// requests whose run never started or was cut off (step 39), least recently
// tried first (step 27). Called by the scheduled job, with the time the job
// started. Returns how many of each it ran.
export async function recoverStuckWork(jobStartedAt = Date.now()): Promise<RecoveryCounts> {
  return runStuckWork(await findStuckWork(), {}, jobStartedAt);
}

// The unfinished emails, calls and requests of every company tried least
// recently, at most 25 of each.
export async function findStuckWork(): Promise<StuckWork> {
  return {
    emails: await findStuckInboundEmails(BATCH_SIZE),
    calls: await findStuckCalls(BATCH_SIZE),
    generations: await findStuckGenerationJobs(BATCH_SIZE),
  };
}

// Runs each through its normal, company-scoped path, which claims it first,
// so nothing is ever handled twice. They take turns (an email, a call, a
// request, an email...): slow emails, or Resend being down, must not leave
// every stuck call for the next run. Starts one only while its longest run
// still ends before the job is cut off. Never throws for one item: those
// paths never throw.
export async function runStuckWork(work: StuckWork, options: RecoveryOptions = {}, jobStartedAt = Date.now()): Promise<RecoveryCounts> {
  const cutOffAt = jobStartedAt + JOB_MAX_DURATION_MS;
  const hasTimeFor = (longestMs: number) => Date.now() + longestMs <= cutOffAt;
  const counts: RecoveryCounts = { emails: 0, calls: 0, generations: 0 };
  const turns = Math.max(work.emails.length, work.calls.length, work.generations.length);
  for (let turn = 0; turn < turns; turn++) {
    const email = work.emails[turn];
    if (email && hasTimeFor(LONGEST_EMAIL_MS)) {
      await processInboundEmail(email.companyId, email.id, options);
      counts.emails += 1;
    }
    const call = work.calls[turn];
    if (call && hasTimeFor(LONGEST_CALL_MS)) {
      await analyzeCall(call.companyId, call.id, options.askModel);
      counts.calls += 1;
    }
    const generation = work.generations[turn];
    if (generation && hasTimeFor(LONGEST_GENERATION_MS)) {
      await runGenerationJob(generation.companyId, generation.id, options.generation);
      counts.generations += 1;
    }
  }
  return counts;
}
