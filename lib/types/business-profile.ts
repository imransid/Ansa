import type { BusinessFactGroup, BusinessFactTopic, FactConfirmationSource, FactProposalSource } from "@/lib/business-facts";
import type { ProfileCompletion } from "@/lib/cofounder/profile-status";

// The company's business profile (step 36): what the Co-Founder knows about
// the business, topic by topic. Members read it; only owners confirm,
// dismiss or edit.

export type ProfileTopic = {
  topic: BusinessFactTopic;
  label: string;
  isKey: boolean;
  confirmed: { value: string; source: FactConfirmationSource; at: Date; byName: string | null } | null;
  proposal: { value: string; source: FactProposalSource; at: Date } | null;
};

export type BusinessProfile = {
  groups: { group: BusinessFactGroup; label: string; topics: ProfileTopic[] }[];
  completion: ProfileCompletion;
  // Key topics with neither a confirmed value nor a proposal, in the interview's order.
  missingKeyTopics: { topic: BusinessFactTopic; label: string }[];
};
