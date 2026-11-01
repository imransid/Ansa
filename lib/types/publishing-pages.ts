import type { ContentDraftStatus, ContentFormat } from "@/lib/content-studio/formats";
import type { PublishJobStatus } from "@/lib/publishing/kinds";
import type { SocialPlatform } from "@/lib/social-platforms";
import type { AutopublishRuleListItem } from "@/lib/types/autopublish-rules";
import type { ActivityListItem } from "@/lib/types/cofounder-activity";
import type { PublishJobCounts, PublishJobListItem } from "@/lib/types/publish-jobs";

// What the Co-Founder's queue and calendar pages show (step 41). Everyone in
// the company reads both; only owners act.

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
