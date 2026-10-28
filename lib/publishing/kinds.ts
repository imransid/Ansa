// What the publishing queue (step 41) works with: a publish job's statuses,
// how it was allowed to go out, and the words the pages use. A file of its
// own with no imports, so the pages in the browser and the database schema
// (db/schema/publishing.ts, whose CHECKs list the same values; a check
// proves they agree) read one list.

// queued: waits for its time (run_after). publishing: one run claimed it and
// is sending it. published: the platform made it (or an owner checked the
// platform and said so). failed: nothing went out, and a code says why; an
// owner may retry. canceled: taken out of the queue before it ran (by an
// owner, or by a change of the draft). needs_attention: the platform may or
// may not have made it (a cut-off answer, a run cut off while sending): it is
// never sent again by itself (IMPLEMENTATION_PLAN decision 8), a person checks.
export const publishJobStatuses = ["queued", "publishing", "published", "failed", "canceled", "needs_attention"] as const;
export type PublishJobStatus = (typeof publishJobStatuses)[number];

// The jobs that count for "one job per draft and account" (the partial
// unique index): a post on its way, out, or maybe out. A failed or canceled
// one leaves room for a new one.
export const LIVE_JOB_STATUSES: readonly PublishJobStatus[] = ["queued", "publishing", "published", "needs_attention"];

export const PUBLISH_JOB_STATUS_LABELS: Record<PublishJobStatus, string> = {
  queued: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  failed: "Failed",
  canceled: "Canceled",
  needs_attention: "Needs attention",
};

// owner: an owner approved exactly the version the job publishes. auto_rule:
// an owner's auto-publish rule let it go out without an approval of its own.
export const publishApprovalModes = ["owner", "auto_rule"] as const;
export type PublishApprovalMode = (typeof publishApprovalModes)[number];
