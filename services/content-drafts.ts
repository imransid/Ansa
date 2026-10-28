import "server-only";
import { z } from "zod";
import {
  countContentDraftsPerStatus,
  getContentDraftForCompany,
  getContentDraftsForCompany,
  type ContentDraftDetail,
  type ContentDraftListItem,
  type ContentDraftStatusCounts,
} from "@/db/content-drafts";
import { createContentDraft } from "@/db/content-draft-writes";
import { getKnowledgeArticleTitles } from "@/db/knowledge-lookups";
import { labelOfTopic } from "@/lib/business-facts";
import { readFactsUsed } from "@/lib/content-studio/claims";
import { wasEditedByHand, type ContentFields } from "@/lib/content-studio/draft-fields";
import { reviewDraft, type DraftReview } from "@/lib/content-studio/review";
import type { ConfirmedFact } from "@/lib/marketing-plan/plan-prompt";
import { findMissingPlanFacts, type MissingPlanFact } from "@/lib/marketing-plan/plan-readiness";
import type { SessionContext } from "@/lib/session";
import { draftIdOnlySchema, newDraftSchema } from "@/lib/validation/content-drafts";
import type { ContentDraftListQuery, ContentDraftPlatformFilter } from "@/lib/validation/list-queries";
import { tooManyDraftChanges, type CreatedDraftResult } from "./content-draft-messages";
import { readCurrentPlan, type CurrentPlan } from "./content-generation-inputs";
import { getDraftMediaPanelForSession, type DraftMediaPanel } from "./draft-media";
import { getConfirmedFactsForSession } from "./marketing-plan-inputs";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// The Co-Founder's content studio (step 38): the list of drafts, one draft
// with everything its page shows, and blank drafts. Everyone in the company
// reads and writes drafts; only owners approve and reject
// (services/content-review.ts). The AI's part: services/content-generation.ts.

// Re-exported so pages can use the types without importing from /db.
export type { ContentDraftListItem, ContentDraftStatusCounts, MissingPlanFact };

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

// Lists one page of the session company's drafts, last changed first.
export async function listContentDraftsForSession(session: SessionContext, page: number, query: ContentDraftListQuery): Promise<ContentDraftListItem[]> {
  return getContentDraftsForCompany(session.companyId, query, page);
}

// Counts the session company's drafts by status on one platform (or all).
export async function countContentDraftsForSession(session: SessionContext, platform: ContentDraftPlatformFilter): Promise<ContentDraftStatusCounts> {
  return countContentDraftsPerStatus(session.companyId, platform);
}

// Reads one draft of the session's company by the id in the URL, with its
// review. Null for a malformed id and for a draft that is not this company's.
export async function getContentDraftPageForSession(session: SessionContext, draftId: unknown): Promise<ContentDraftPage | null> {
  const parsed = draftIdOnlySchema.safeParse({ draftId });
  if (!parsed.success) {
    return null;
  }
  const [draft, facts, plan] = await Promise.all([
    getContentDraftForCompany(session.companyId, parsed.data.draftId),
    getConfirmedFactsForSession(session),
    readCurrentPlan(session.companyId),
  ]);
  if (!draft) {
    return null;
  }
  const media = await getDraftMediaPanelForSession(session, draft);
  const fields: ContentFields = {
    title: draft.title,
    body: draft.body,
    hashtags: draft.hashtags,
    callToAction: draft.callToAction,
    imagePrompt: draft.imagePrompt,
    videoScript: draft.videoScript,
  };
  return {
    id: draft.id,
    platform: draft.platform,
    format: draft.format,
    status: draft.status,
    topic: draft.topic,
    pillar: draft.pillar,
    campaign: draft.campaign,
    version: draft.version,
    generatedVersion: draft.generatedVersion,
    plannedFor: draft.plannedFor,
    fields,
    editedByHand: wasEditedByHand({ ...fields, version: draft.version, generatedVersion: draft.generatedVersion }),
    createdAt: draft.createdAt,
    createdByName: draft.createdByName,
    updatedAt: draft.updatedAt,
    updatedByName: draft.updatedByName,
    approval: describeApproval(draft),
    rejection: draft.rejectedAt ? { at: draft.rejectedAt, byName: draft.rejectedByName, note: draft.rejectionNote } : null,
    review: reviewDraft({ ...draft, media: media.attached ? { kind: media.attached.kind, altText: media.attached.altText } : null }, facts),
    madeFrom: await describeMadeFrom(session.companyId, draft),
    businessName: facts.find((fact) => fact.topic === "company_name")?.value ?? null,
    planChoices: planChoicesOf(plan),
    media,
  };
}

// What "New draft" needs to know about the session's company.
export async function getNewDraftOptionsForSession(session: SessionContext): Promise<NewDraftOptions> {
  const [facts, plan] = await Promise.all([getConfirmedFactsForSession(session), readCurrentPlan(session.companyId)]);
  return { missingForAi: missingForAi(facts), planChoices: planChoicesOf(plan) };
}

// Saves a blank draft (an idea: its topic, nothing written) for the
// session's company. Anyone in the company.
export async function createBlankDraftForSession(session: SessionContext, input: unknown): Promise<CreatedDraftResult> {
  const parsed = newDraftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  if (await isOverRateLimit("content-draft-changes", session.userId, RATE_LIMITS.contentDraftChangesPerUser)) {
    return tooManyDraftChanges();
  }
  const created = await createContentDraft(session.companyId, session.userId, { ...parsed.data, generated: null });
  return created.outcome === "created" ? { ok: true, draftId: created.draftId } : { ok: false, errors: { message: "You can't add drafts to this company." } };
}

// What the AI still needs before it writes a draft: what a plan needs.
function missingForAi(facts: ConfirmedFact[]): MissingPlanFact[] {
  return findMissingPlanFacts(new Set(facts.map((fact) => fact.topic)));
}

// The current plan's pillar and campaign names for the menus (none without a plan).
function planChoicesOf(plan: CurrentPlan | null): PlanChoices {
  if (!plan) {
    return { planVersion: null, pillars: [], campaigns: [] };
  }
  return {
    planVersion: plan.version,
    pillars: plan.content.pillars.map((pillar) => pillar.name),
    campaigns: plan.content.campaigns.map((campaign) => campaign.name),
  };
}

// The approval of the version on screen while it holds: approved, and on
// its way out or out since (scheduled, published, failed; step 41).
function describeApproval(draft: ContentDraftDetail): ContentDraftPage["approval"] {
  if (!draft.approvedAt || draft.approvedVersion !== draft.version) {
    return null;
  }
  return {
    at: draft.approvedAt,
    byName: draft.approvedByName,
    version: draft.approvedVersion,
    claimsChecked: draft.claimsAcknowledgedAt !== null,
    byActiveOwner: draft.approverRole === "owner" && draft.approverDeactivatedAt === null,
  };
}

// The facts as they were sent, and the articles' titles read within the company.
async function describeMadeFrom(companyId: string, draft: ContentDraftDetail): Promise<ContentDraftPage["madeFrom"]> {
  if (draft.generatedVersion === null) {
    return null;
  }
  const titles = await getKnowledgeArticleTitles(companyId, draft.knowledgeUsed);
  return {
    facts: readFactsUsed(draft.factsUsed).map((fact) => ({ topic: fact.topic, label: labelOfTopic(fact.topic), value: fact.value })),
    knowledge: draft.knowledgeUsed.map((articleId) => ({ articleId, title: titles.get(articleId) ?? null })),
    planVersion: draft.planVersion,
  };
}
