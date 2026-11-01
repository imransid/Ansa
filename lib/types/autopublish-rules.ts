import type { SocialPlatform } from "@/lib/social-platforms";

// One of the company's auto-publish rules (step 41), as the queue page lists
// it. Rules are made switched off; only an owner's explicit confirm turns
// one on.
export type AutopublishRuleListItem = {
  id: string;
  platform: SocialPlatform;
  pillar: string;
  enabled: boolean;
  createdAt: Date;
  createdByName: string | null;
  enabledAt: Date | null;
  enabledByName: string | null;
};
