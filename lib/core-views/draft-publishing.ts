import "server-only";
import { callCore } from "@/lib/core-api";
import { draftIdOnlySchema } from "@/lib/validation/content-drafts";
import type { DraftPublishing } from "@/services/draft-publishing";

// A draft's Publish section through the new backend (core's GET
// /api/v1/cofounder/publishing/drafts/{id}): its posts, the accounts of its
// platform, whether it can be scheduled and under whose authority, and its
// own activity, in the shape the section already reads. Its actions
// (schedule, cancel, retry, ...) are the publishing queue's.

type Job = DraftPublishing["jobs"][number];
type Entry = DraftPublishing["activity"][number];

// Dates come as ISO text.
type CoreJob = Omit<Job, "scheduledFor" | "runAfter" | "publishedAt" | "updatedAt"> & {
  scheduledFor: string;
  runAfter: string;
  publishedAt: string | null;
  updatedAt: string;
};
type CoreEntry = Omit<Entry, "createdAt"> & { createdAt: string };
type CoreDraftPublishing = Omit<DraftPublishing, "jobs" | "activity"> & { jobs: CoreJob[]; activity: CoreEntry[] };

// One draft's section; null for a malformed id, an unknown draft or another company's.
export async function getDraftPublishingFromCore(draftId: string): Promise<DraftPublishing | null> {
  const parsed = draftIdOnlySchema.safeParse({ draftId });
  if (!parsed.success) {
    return null;
  }
  const answer = await callCore<CoreDraftPublishing>("GET", `/api/v1/cofounder/publishing/drafts/${parsed.data.draftId}`);
  if (!answer.ok && answer.status === 404) {
    return null;
  }
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  const { jobs, activity, ...rest } = answer.data;
  return {
    ...rest,
    jobs: jobs.map((job) => ({
      ...job,
      scheduledFor: new Date(job.scheduledFor),
      runAfter: new Date(job.runAfter),
      publishedAt: job.publishedAt ? new Date(job.publishedAt) : null,
      updatedAt: new Date(job.updatedAt),
    })),
    activity: activity.map((entry) => ({ ...entry, createdAt: new Date(entry.createdAt) })),
  };
}
