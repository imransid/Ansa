import "server-only";
import { findRuleCoveringDraft } from "@/db/autopublish-rules";
import { listActivityForDraft, type ActivityListItem } from "@/db/cofounder-activity";
import { getPublishJobsForDraft, type PublishJobListItem } from "@/db/publish-jobs";
import { listSocialConnections } from "@/db/social-connections";
import { canManagePublishing } from "@/lib/cofounder/permissions";
import type { ContentDraftStatus, ContentFormat } from "@/lib/content-studio/formats";
import { LIVE_JOB_STATUSES } from "@/lib/publishing/kinds";
import { ACTIVITY_SHOWN } from "@/lib/publishing/limits";
import type { SessionContext } from "@/lib/session";
import { PUBLISHED_FORMATS, type SocialConnectionStatus, type SocialPlatform } from "@/lib/social-platforms";

// What a draft's page shows about publishing it (step 41): its posts (one
// per account it was scheduled to), the accounts of its platform it could
// go to, whether it can be scheduled and under whose authority, and its own
// activity. Scheduling decides again, locked (db/publish-scheduling.ts).

export type PublishAccountChoice = {
  id: string;
  displayName: string;
  isStandIn: boolean;
  status: SocialConnectionStatus;
  // The draft is on its way, out, or maybe out there already.
  hasLiveJob: boolean;
};

export type DraftPublishing = {
  jobs: PublishJobListItem[];
  accounts: PublishAccountChoice[];
  // ansa can publish this format to this platform (PUBLISHED_FORMATS).
  formatPublishable: boolean;
  // An enabled auto-publish rule would cover it (by its platform and pillar).
  coveringRule: { platform: SocialPlatform; pillar: string } | null;
  activity: ActivityListItem[];
  canManage: boolean;
  // A post of it is going out, or due and about to: the page refreshes itself.
  isBusy: boolean;
};

// The most posts of one draft its page lists (one per account, and the
// failed or canceled ones before them).
const DRAFT_JOBS_SHOWN = 100;
// A post due this recently is being picked up by the run after the answer
// that made it due (scheduled for now, sent now, tried again).
const JUST_DUE_MS = 2 * 60 * 1000;

// What one of the session company's drafts shows about publishing it.
export async function getDraftPublishingForSession(
  session: SessionContext,
  draft: { id: string; platform: SocialPlatform; format: ContentFormat; pillar: string; status: ContentDraftStatus },
  now = new Date(),
): Promise<DraftPublishing> {
  const [jobs, connections, coveringRule, activity] = await Promise.all([
    getPublishJobsForDraft(session.companyId, draft.id, DRAFT_JOBS_SHOWN),
    listSocialConnections(session.companyId),
    findRuleCoveringDraft(session.companyId, draft),
    listActivityForDraft(session.companyId, draft.id, ACTIVITY_SHOWN),
  ]);
  const liveAccounts = new Set(jobs.filter((job) => LIVE_JOB_STATUSES.includes(job.status)).map((job) => job.connectionId));
  const accounts = connections
    .filter((connection) => connection.platform === draft.platform && connection.status !== "disconnected")
    .map((connection) => ({
      id: connection.id,
      displayName: connection.displayName,
      isStandIn: connection.isStandIn,
      status: connection.status,
      hasLiveJob: liveAccounts.has(connection.id),
    }));
  return {
    jobs,
    accounts,
    formatPublishable: PUBLISHED_FORMATS[draft.platform].includes(draft.format),
    coveringRule: coveringRule ? { platform: coveringRule.platform, pillar: coveringRule.pillar } : null,
    activity,
    canManage: canManagePublishing(session.role),
    isBusy: jobs.some((job) => job.status === "publishing" || (job.status === "queued" && isJustDue(job.runAfter, now))),
  };
}

function isJustDue(runAfter: Date, now: Date): boolean {
  const dueFor = now.getTime() - runAfter.getTime();
  return dueFor >= 0 && dueFor <= JUST_DUE_MS;
}
