import "server-only";
import { callCore } from "@/lib/core-api";
import { toActivityListItem, toPublishJobListItem, type CoreActivityEntry, type CorePublishJob } from "@/lib/core-views/queue";
import { draftIdOnlySchema } from "@/lib/validation/content-drafts";
import type { DraftPublishing } from "@/services/draft-publishing";

// A draft's Publish section through the new backend (core's GET
// /api/v1/cofounder/publishing/drafts/{id}): its posts, the accounts of its
// platform, whether it can be scheduled and under whose authority, and its
// own activity, in the shape the section already reads. Its actions
// (schedule, cancel, retry, ...) are the publishing queue's.

// Dates come as ISO text: the posts and activity lines are read as the
// queue page reads them (lib/core-views/queue.ts).
type CoreDraftPublishing = Omit<DraftPublishing, "jobs" | "activity"> & { jobs: CorePublishJob[]; activity: CoreActivityEntry[] };

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
  return { ...rest, jobs: jobs.map(toPublishJobListItem), activity: activity.map(toActivityListItem) };
}
