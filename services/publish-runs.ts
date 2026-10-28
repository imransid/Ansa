import "server-only";
import { claimNextDuePublishJob, claimPublishJob, findStalePublishingJobs, hasDuePublishJob, markStaleJobNeedsAttention, type PublishClaim } from "@/db/publish-runs";
import { describeErrorWithFrames } from "@/lib/safe-error-logging";
import { LONGEST_PUBLISH_MS } from "@/lib/social-publishing";
import { MEDIA_READ_TIMEOUT_MS, sendClaimedJob, type PublishAttemptOptions, type PublishAttemptOutcome } from "./publish-attempt";
import { LONGEST_PREPARATION_MS } from "./social-tokens";

// Running the publishing queue (step 41). Jobs are rows, so a restart loses
// none: whichever run comes next takes them. Three kinds of run: right
// after an answer that made posts due (scheduled for now, "Publish now", a
// Retry: runPublishJobsNow, through Next's after()), /api/cron/publish (any
// scheduler, every minute at best), and the daily job as a fallback
// (runDuePublishJobs). Each claims a job in ONE UPDATE first
// (db/publish-runs.ts), so two runs never send the same post.

// The time the routes and pages these runs live in may take (maxDuration:
// the cron route, the daily job, the draft, queue and calendar pages).
export const PUBLISH_RUN_BUDGET_MS = 300_000;

// Room for one job's own database work: a query may wait 10 seconds for a
// free connection (db/client.ts).
const DATABASE_ALLOWANCE_MS = 10_000;

// The longest one job can take when everything is slow: the account's
// permission made ready, its image or video read, the platform's longest
// publish, the database. A job is started only while this still fits
// before the request is cut off: one killed half-way stays "publishing",
// for a person to check.
export const LONGEST_PUBLISH_RUN_MS = LONGEST_PREPARATION_MS + MEDIA_READ_TIMEOUT_MS + LONGEST_PUBLISH_MS + DATABASE_ALLOWANCE_MS;

// The most jobs cut off while sending, and the most due ones, one run takes.
const STALE_BATCH_SIZE = 100;
const DUE_BATCH_SIZE = 50;

export type PublishRunCounts = { interrupted: number; published: number; failed: number; needsAttention: number; requeued: number };

export type PublishRunOptions = PublishAttemptOptions & {
  // Only the checks pass it: they keep to their own companies.
  onlyCompanyIds?: string[];
};

// Sends these jobs of one company one after another, right after the answer
// that made them due. Each is started only while its longest run fits in the
// page's 300 seconds from startedAt; one not started stays queued and due,
// for the next run. Never throws.
export async function runPublishJobsNow(
  companyId: string,
  jobIds: string[],
  options: PublishRunOptions = {},
  startedAt = Date.now(),
): Promise<PublishAttemptOutcome[]> {
  const outcomes: PublishAttemptOutcome[] = [];
  try {
    for (const jobId of jobIds) {
      if (!hasTimeFor(startedAt)) {
        break;
      }
      const claim = await claimPublishJob(companyId, jobId);
      if (claim) {
        outcomes.push(await sendClaimedJob(claim, options));
      }
    }
  } catch (error) {
    console.error(`Publish job run failed: ${describeErrorWithFrames(error)}`);
  }
  return outcomes;
}

// What /api/cron/publish and the daily job run: first the jobs cut off while
// sending go to a person ("needs attention", never sent again by
// themselves), then due jobs of every company are claimed and sent, the
// companies taking turns, while another still fits in the request's 300
// seconds from jobStartedAt. Never throws.
export async function runDuePublishJobs(jobStartedAt = Date.now(), options: PublishRunOptions = {}): Promise<PublishRunCounts> {
  const counts: PublishRunCounts = { interrupted: 0, published: 0, failed: 0, needsAttention: 0, requeued: 0 };
  try {
    for (const job of await findStalePublishingJobs(STALE_BATCH_SIZE, options.onlyCompanyIds)) {
      if (await markStaleJobNeedsAttention(job)) {
        console.warn("Publish job needs attention: interrupted");
        counts.interrupted += 1;
      }
    }
    await sendDueJobsInTurns(jobStartedAt, options, counts);
  } catch (error) {
    console.error(`Publish job run failed: ${describeErrorWithFrames(error)}`);
  }
  return counts;
}

// Who had a turn in this run's current round, and whose daily limit held a
// post back (no more turns for them in this run: their other posts would
// be held back too, each claim of them costing a turn of someone else's).
type Turns = { servedThisRound: Set<string>; heldBack: Set<string> };

// Claims and sends due jobs one after another, the companies taking turns:
// in each round every company with due jobs sends its longest waiting one,
// and a new round starts once all had theirs. WHY turns: one company's long
// queue must not take every post a run can start (DUE_BATCH_SIZE, and only
// its first ~30 seconds) from the others.
async function sendDueJobsInTurns(jobStartedAt: number, options: PublishRunOptions, counts: PublishRunCounts): Promise<void> {
  const turns: Turns = { servedThisRound: new Set(), heldBack: new Set() };
  for (let started = 0; started < DUE_BATCH_SIZE; started++) {
    if (!hasTimeFor(jobStartedAt)) {
      await sayIfDueJobsAreLeft("time limit", turns, options);
      return;
    }
    const claim = await claimNextTurn(turns, options.onlyCompanyIds);
    if (!claim) {
      return;
    }
    const outcome = await sendClaimedJob(claim, options);
    if (outcome === "held_back") {
      turns.heldBack.add(claim.companyId);
    }
    countOutcome(counts, outcome);
  }
  await sayIfDueJobsAreLeft("batch size", turns, options);
}

// The longest waiting due job of a company that hasn't had its turn in this
// round; when every company with due jobs had one, a new round starts.
async function claimNextTurn(turns: Turns, onlyCompanyIds: string[] | undefined): Promise<PublishClaim | undefined> {
  let claim = await claimNextDuePublishJob({ skipCompanyIds: [...turns.servedThisRound, ...turns.heldBack], onlyCompanyIds });
  if (!claim && turns.servedThisRound.size > 0) {
    turns.servedThisRound.clear();
    claim = await claimNextDuePublishJob({ skipCompanyIds: [...turns.heldBack], onlyCompanyIds });
  }
  if (claim) {
    turns.servedThisRound.add(claim.companyId);
  }
  return claim;
}

// One fixed line when the run stops at its limit while posts are still due
// (not counting companies past their daily limit): the next run takes
// them, and a line that keeps coming means posts go out late.
async function sayIfDueJobsAreLeft(limit: "time limit" | "batch size", turns: Turns, options: PublishRunOptions): Promise<void> {
  if (await hasDuePublishJob({ skipCompanyIds: [...turns.heldBack], onlyCompanyIds: options.onlyCompanyIds })) {
    console.warn(`Publish run stopped at its ${limit}: due posts are left for the next run`);
  }
}

function hasTimeFor(startedAt: number): boolean {
  return Date.now() + LONGEST_PUBLISH_RUN_MS <= startedAt + PUBLISH_RUN_BUDGET_MS;
}

// A post held back by the daily limit is back in the queue, as one a
// platform asked to wait for.
function countOutcome(counts: PublishRunCounts, outcome: PublishAttemptOutcome): void {
  if (outcome === "published") {
    counts.published += 1;
  } else if (outcome === "failed") {
    counts.failed += 1;
  } else if (outcome === "needs_attention") {
    counts.needsAttention += 1;
  } else if (outcome === "requeued" || outcome === "held_back") {
    counts.requeued += 1;
  }
}
