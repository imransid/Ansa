import type { ContentFormat } from "@/lib/content-studio/formats";
import type { PublishApprovalMode, PublishJobStatus } from "@/lib/publishing/kinds";
import type { SocialConnectionStatus, SocialPlatform } from "@/lib/social-platforms";

// The company's publish jobs (step 41) as the queue, a draft's page and the
// Analytics page's problems list them. A post cut off while sending (still
// "publishing" 10+ minutes after its claim) is listed and counted as
// needing attention ("interrupted") at once.

export type PublishJobListItem = {
  id: string;
  status: PublishJobStatus;
  scheduledFor: Date;
  runAfter: Date;
  attempts: number;
  lastError: string | null;
  publishedAt: Date | null;
  externalUrl: string | null;
  approvalMode: PublishApprovalMode;
  approvedVersion: number;
  updatedAt: Date;
  draftId: string;
  draftTopic: string;
  draftPlatform: SocialPlatform;
  draftFormat: ContentFormat;
  connectionId: string;
  connectionName: string | null;
  connectionStatus: SocialConnectionStatus | null;
  connectionIsStandIn: boolean | null;
  createdByName: string | null;
  canceledByName: string | null;
  // For a job under an auto-publish rule: whether the rule is still on.
  ruleEnabled: boolean | null;
  // A failed post whose account has the draft on its way, out or waiting for
  // a check again (scheduled or tried again there since): it no longer
  // counts for the draft, and can't be tried again.
  scheduledAgain: boolean;
};

export type PublishJobCounts = Record<PublishJobStatus, number>;
