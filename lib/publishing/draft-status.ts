import type { ContentDraftStatus } from "@/lib/content-studio/formats";
import { LIVE_JOB_STATUSES, type PublishJobStatus } from "./kinds";

// A content draft's status while the publishing queue (step 41) has it.
// Pure: /db (db/publish-draft-sync.ts) applies it after every change of a
// draft's jobs, in the transaction that changes them.

// The statuses the queue owns: while a draft has one of these, its jobs
// decide it. Any other (a draft again after an edit, rejected, archived) a
// person chose, and a job ending later never overwrites it.
export const QUEUE_DRAFT_STATUSES: readonly ContentDraftStatus[] = ["scheduled", "published", "failed"];

// One of the draft's jobs: the account it goes to, and how it stands.
export type JobOfDraft = { connectionId: string; status: PublishJobStatus };

// What a draft's jobs make it: scheduled while one is on its way; failed
// while one failed or needs a person and none is on its way; published once
// every one went out. With none left (all canceled): approved while its
// approval of this version holds, else a draft again (one an auto-publish
// rule scheduled has none). A failed job whose account has the draft on
// its way, out or waiting for a check again (scheduled or tried again there
// since) doesn't count: that other job is what the account has now.
export function draftStatusFromJobs(jobs: readonly JobOfDraft[], approvalHolds: boolean): ContentDraftStatus {
  const counted = jobs.filter((job) => job.status !== "canceled" && !isReplacedFailure(job, jobs)).map((job) => job.status);
  if (counted.some((status) => status === "queued" || status === "publishing")) {
    return "scheduled";
  }
  if (counted.some((status) => status === "failed" || status === "needs_attention")) {
    return "failed";
  }
  if (counted.length > 0) {
    return "published";
  }
  return approvalHolds ? "approved" : "draft";
}

// A failed job of an account that has a live job of the same draft (at most
// one: the partial unique index of db/schema/publishing.ts).
function isReplacedFailure(job: JobOfDraft, jobs: readonly JobOfDraft[]): boolean {
  return job.status === "failed" && jobs.some((other) => other.connectionId === job.connectionId && LIVE_JOB_STATUSES.includes(other.status));
}
