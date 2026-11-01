import type { SocialConnectionStatus, SocialPlatform } from "@/lib/social-platforms";
import type { ActivityListItem } from "@/lib/types/cofounder-activity";
import type { PublishJobListItem } from "@/lib/types/publish-jobs";

// What a draft's page shows about publishing it (step 41): its posts (one
// per account it was scheduled to), the accounts of its platform it could
// go to, whether it can be scheduled and under whose authority, and its own
// activity. Scheduling decides again, locked, when it is asked.

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
