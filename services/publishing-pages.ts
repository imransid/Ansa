import "server-only";
import { listAutopublishRules, type AutopublishRuleListItem } from "@/db/autopublish-rules";
import { listActivityForCompany, type ActivityListItem } from "@/db/cofounder-activity";
import { getPlannedDraftsBetween } from "@/db/content-calendar";
import { countPublishJobsPerStatus, getPublishJobsBetween, getPublishJobsForCompany, type PublishJobCounts, type PublishJobListItem } from "@/db/publish-jobs";
import { canManagePublishing, canPlanContentCalendar } from "@/lib/cofounder/permissions";
import type { ContentDraftStatus, ContentFormat } from "@/lib/content-studio/formats";
import type { PublishJobStatus } from "@/lib/publishing/kinds";
import { ACTIVITY_SHOWN, CALENDAR_DAYS, FINISHED_JOBS_SHOWN } from "@/lib/publishing/limits";
import type { SessionContext } from "@/lib/session";
import type { SocialPlatform } from "@/lib/social-platforms";
import { readCurrentPlan } from "./content-generation-inputs";

// What the Co-Founder's queue and calendar pages show (step 41), read for
// the session's company. Everyone in the company reads both; only owners
// act (the pages hide what /db would refuse anyway).

// Re-exported so pages can use the types without importing from /db.
export type { ActivityListItem, AutopublishRuleListItem, PublishJobCounts, PublishJobListItem };

export type QueuePage = {
  counts: PublishJobCounts;
  waiting: PublishJobListItem[];
  needsAttention: PublishJobListItem[];
  failed: PublishJobListItem[];
  published: PublishJobListItem[];
  canceled: PublishJobListItem[];
  rules: AutopublishRuleListItem[];
  // The current plan's content pillars, for a new rule (none without a plan).
  pillars: string[];
  activity: ActivityListItem[];
  canManage: boolean;
  // A post is going out, or due and about to: the page refreshes itself.
  isBusy: boolean;
};

// One thing on the calendar: a post on its way (or out) to an account, or
// a draft or idea planned for a day.
export type CalendarItem = {
  kind: "job" | "draft";
  id: string;
  // When, as an ISO string: the browser puts it on the viewer's own day.
  at: string;
  draftId: string;
  topic: string;
  platform: SocialPlatform;
  format: ContentFormat;
  status: PublishJobStatus | ContentDraftStatus;
  accountName: string | null;
};

export type CalendarPage = { items: CalendarItem[]; planVersion: number | null; canPlan: boolean };

// Every waiting job and every one needing attention are listed up to this
// many (a company has a few dozen at most).
const OPEN_JOBS_SHOWN = 200;
// The calendar reads at most this many of each kind.
const CALENDAR_ITEMS_MAX = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
const JUST_DUE_MS = 2 * 60 * 1000;

// The queue of the session's company: its jobs by status, the auto-publish
// rules, and the newest activity.
export async function getQueuePageForSession(session: SessionContext, now = new Date()): Promise<QueuePage> {
  const { companyId } = session;
  const [counts, waiting, needsAttention, failed, published, canceled, rules, plan, activity] = await Promise.all([
    countPublishJobsPerStatus(companyId),
    getPublishJobsForCompany(companyId, ["publishing", "queued"], OPEN_JOBS_SHOWN),
    getPublishJobsForCompany(companyId, ["needs_attention"], OPEN_JOBS_SHOWN),
    getPublishJobsForCompany(companyId, ["failed"], FINISHED_JOBS_SHOWN),
    getPublishJobsForCompany(companyId, ["published"], FINISHED_JOBS_SHOWN),
    getPublishJobsForCompany(companyId, ["canceled"], FINISHED_JOBS_SHOWN),
    listAutopublishRules(companyId),
    readCurrentPlan(companyId),
    listActivityForCompany(companyId, ACTIVITY_SHOWN),
  ]);
  const pillars = plan?.content.pillars.map((pillar) => pillar.name) ?? [];
  const isBusy = waiting.some((job) => job.status === "publishing" || isJustDue(job, now));
  return { counts, waiting, needsAttention, failed, published, canceled, rules, pillars, activity, canManage: canManagePublishing(session.role), isBusy };
}

// The calendar of the session's company: its posts and planned drafts from
// a day before now to a day past the calendar's weeks (the browser keeps
// the days of the viewer's own timezone), and whether it has a plan.
export async function getCalendarPageForSession(session: SessionContext, now = new Date()): Promise<CalendarPage> {
  const from = new Date(now.getTime() - DAY_MS);
  const to = new Date(now.getTime() + (CALENDAR_DAYS + 1) * DAY_MS);
  const [jobs, drafts, plan] = await Promise.all([
    getPublishJobsBetween(session.companyId, from, to, CALENDAR_ITEMS_MAX),
    getPlannedDraftsBetween(session.companyId, from, to, CALENDAR_ITEMS_MAX),
    readCurrentPlan(session.companyId),
  ]);
  const jobItems: CalendarItem[] = jobs.map((job) => ({
    kind: "job",
    id: job.id,
    at: (job.publishedAt ?? job.scheduledFor).toISOString(),
    draftId: job.draftId,
    topic: job.draftTopic,
    platform: job.draftPlatform,
    format: job.draftFormat,
    status: job.status,
    accountName: job.connectionName,
  }));
  const draftItems: CalendarItem[] = drafts.map((draft) => ({
    kind: "draft",
    id: draft.id,
    at: draft.plannedFor.toISOString(),
    draftId: draft.id,
    topic: draft.topic,
    platform: draft.platform,
    format: draft.format,
    status: draft.status,
    accountName: null,
  }));
  const items = [...jobItems, ...draftItems].sort((first, second) => first.at.localeCompare(second.at));
  return { items, planVersion: plan?.version ?? null, canPlan: canPlanContentCalendar(session.role) };
}

// Due a moment ago: a post scheduled for now, sent now or tried again, which
// the run after that answer is picking up. One due longer ago waits for the
// next scheduled run, and the page doesn't wait with it.
function isJustDue(job: PublishJobListItem, now: Date): boolean {
  const dueFor = now.getTime() - job.runAfter.getTime();
  return dueFor >= 0 && dueFor <= JUST_DUE_MS;
}
