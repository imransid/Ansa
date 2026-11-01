import type { UserRole } from "@/db/schema";
import type { ContentFields } from "@/lib/content-studio/draft-fields";
import type { ContentDraftStatus, ContentFormat } from "@/lib/content-studio/formats";
import type { DraftReview } from "@/lib/content-studio/review";
import type { MissingPlanFact } from "@/lib/marketing-plan/plan-readiness";
import type { SocialPlatform } from "@/lib/social-platforms";
import type { DraftMediaPanel } from "@/lib/types/draft-media";
import type { ContentDraftStatusFilter } from "@/lib/validation/list-queries";

// The Co-Founder's content studio (step 38): the list of drafts and its
// counts, one draft with everything its page shows, and what "New draft"
// offers. Everyone in the company reads and writes drafts; only owners
// approve and reject.

export type ContentDraftListItem = {
  id: string;
  topic: string;
  platform: SocialPlatform;
  format: ContentFormat;
  status: ContentDraftStatus;
  version: number;
  updatedAt: Date;
  updatedByName: string | null;
};

export type ContentDraftStatusCounts = Record<ContentDraftStatusFilter, number>;

// One draft as stored, with who made, changed, approved or rejected it.
export type ContentDraftDetail = Omit<ContentDraftListItem, "updatedByName"> & {
  pillar: string;
  campaign: string;
  title: string;
  body: string;
  hashtags: string[];
  callToAction: string;
  imagePrompt: string;
  videoScript: string;
  // The image or video attached from the media library (step 39), or null.
  mediaAssetId: string | null;
  generatedVersion: number | null;
  // As stored: the services read them with lib/content-studio/claims.ts.
  claims: unknown;
  factsUsed: unknown;
  knowledgeUsed: string[];
  planVersion: number | null;
  createdAt: Date;
  createdByName: string | null;
  updatedByName: string | null;
  approvedAt: Date | null;
  approvedVersion: number | null;
  approvedByName: string | null;
  // The approver's role and removal now (step 41): an approval by someone
  // made a member or removed since lets nothing go out.
  approverRole: UserRole | null;
  approverDeactivatedAt: Date | null;
  claimsAcknowledgedAt: Date | null;
  rejectedAt: Date | null;
  rejectedByName: string | null;
  rejectionNote: string | null;
  // When it should go out (the calendar, step 41); null: not planned.
  plannedFor: Date | null;
};

// The current plan's pillars and campaigns, by name, for the forms' menus.
export type PlanChoices = { planVersion: number | null; pillars: string[]; campaigns: string[] };

export type ContentDraftPage = Pick<
  ContentDraftDetail,
  "id" | "platform" | "format" | "status" | "topic" | "pillar" | "campaign" | "version" | "generatedVersion" | "plannedFor"
> & {
  fields: ContentFields;
  // Someone changed the AI's text by hand (or wrote it): Regenerate asks first.
  editedByHand: boolean;
  createdAt: Date;
  createdByName: string | null;
  updatedAt: Date;
  updatedByName: string | null;
  // byActiveOwner: false once the approver was made a member or removed;
  // then nothing goes out until another owner approves it again.
  approval: { at: Date; byName: string | null; version: number; claimsChecked: boolean; byActiveOwner: boolean } | null;
  // The last rejection, kept until the draft is approved.
  rejection: { at: Date; byName: string | null; note: string | null } | null;
  // The rules and the claims of the saved version, against the facts now.
  review: DraftReview;
  // What the AI's request held when it last wrote the text (null: it never did).
  madeFrom: { facts: { topic: string; label: string; value: string }[]; knowledge: { articleId: string; title: string | null }[]; planVersion: number | null } | null;
  // The confirmed business name, for the preview (null: not confirmed).
  businessName: string | null;
  planChoices: PlanChoices;
  // Its image or video from the media library (step 39), and what to attach.
  media: DraftMediaPanel;
};

export type NewDraftOptions = {
  // What the AI needs before it can write a draft (none: it can).
  missingForAi: MissingPlanFact[];
  planChoices: PlanChoices;
};
