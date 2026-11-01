import type { CofounderActivityAction } from "@/lib/publishing/activity-actions";
import type { SocialPlatform } from "@/lib/social-platforms";

// One line of the Co-Founder's activity log (step 41), as the queue and a
// draft's page list it. Never a token or a post's text.
export type ActivityListItem = {
  id: string;
  action: CofounderActivityAction;
  code: string | null;
  createdAt: Date;
  // Empty: the app did it.
  actorUserId: string | null;
  actorName: string | null;
  draftId: string | null;
  draftTopic: string | null;
  draftPlatform: SocialPlatform | null;
  jobId: string | null;
  connectionPlatform: SocialPlatform | null;
  connectionName: string | null;
  rulePlatform: SocialPlatform | null;
  rulePillar: string | null;
  planVersion: number | null;
};
