import "server-only";
import { callCore, type CoreAnswer } from "@/lib/core-api";
import { toFormErrors } from "@/lib/core-views/auth";
import type { FormErrors, FormResult } from "@/lib/form-result";
import { findMissingPlanFacts, type MissingPlanFact } from "@/lib/marketing-plan/plan-readiness";
import type { CreatedDraftResult } from "@/lib/types/content-draft-messages";
import type { ContentDraftListItem, ContentDraftStatusCounts, NewDraftOptions } from "@/lib/types/content-drafts";
import { draftIdOnlySchema } from "@/lib/validation/content-drafts";
import type { ContentDraftListQuery, ContentDraftPlatformFilter, ContentDraftStatusFilter } from "@/lib/validation/list-queries";

// The content studio through the new backend (core's
// /api/v1/cofounder/drafts): the list, "New draft" and a draft's changes,
// in the shapes the pages and their actions already read. A draft's page:
// lib/core-views/studio-draft.ts.

// A form value as the forms send it: text, or nothing.
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// The refusal when a form's draft id isn't one (core would say the same).
const UNKNOWN_DRAFT: FormErrors = { message: "Unknown draft. Reload the page and try again." };

// A draft's address in core, or null when the id (a claim from the address
// or a form) isn't a uuid: then it is no draft, and never a path of its own.
export function draftPath(draftId: unknown): string | null {
  const parsed = draftIdOnlySchema.safeParse({ draftId });
  return parsed.success ? `/api/v1/cofounder/drafts/${parsed.data.draftId}` : null;
}

// The version the page showed, as a number (0 when the form held none, or
// one Postgres can't hold: core refuses it).
export function versionNumber(value: unknown): number {
  const version = Number(text(value));
  return Number.isSafeInteger(version) && version <= 2_147_483_647 ? version : 0;
}

function savedOrErrors(answer: CoreAnswer<unknown>): FormResult {
  return answer.ok ? { ok: true } : { ok: false, errors: toFormErrors(answer) };
}

// Dates come as ISO text.
type CoreDraftLine = Omit<ContentDraftListItem, "updatedAt"> & { updatedAt: string };

async function readDraftList(status: ContentDraftStatusFilter, platform: ContentDraftPlatformFilter, page: number) {
  const address = new URLSearchParams({ status, platform, page: String(page) });
  const answer = await callCore<{ drafts: CoreDraftLine[]; counts: ContentDraftStatusCounts }>("GET", `/api/v1/cofounder/drafts?${address.toString()}`);
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  return answer.data;
}

// One page of the company's drafts (50, last changed first) with this
// status and platform, and the counts per status on that platform.
export async function getDraftListFromCore(page: number, query: ContentDraftListQuery): Promise<{ drafts: ContentDraftListItem[]; counts: ContentDraftStatusCounts }> {
  const { drafts, counts } = await readDraftList(query.status, query.platform, page);
  return { drafts: drafts.map((draft) => ({ ...draft, updatedAt: new Date(draft.updatedAt) })), counts };
}

// The counts per status on one platform (or all): the list's own answer,
// its rows left unused.
export async function countDraftsFromCore(platform: ContentDraftPlatformFilter): Promise<ContentDraftStatusCounts> {
  return (await readDraftList("current", platform, 1)).counts;
}

// What "New draft" needs: what the AI still needs confirmed, and the
// current plan's pillars and campaigns.
export async function getNewDraftOptionsFromCore(): Promise<NewDraftOptions> {
  const answer = await callCore<{ missingForAi: string[]; planChoices: NewDraftOptions["planChoices"] }>("GET", "/api/v1/cofounder/drafts/new");
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  return { missingForAi: missingFactsNamed(answer.data.missingForAi), planChoices: answer.data.planChoices };
}

// Core names each missing fact by its label; the page links it to the
// profile topics that would fill it (lib/marketing-plan/plan-readiness.ts).
function missingFactsNamed(labels: string[]): MissingPlanFact[] {
  const everyOne = findMissingPlanFacts(new Set());
  return labels.map((label) => everyOne.find((fact) => fact.label === label) ?? { label, topics: [] });
}

// The fields of "New draft".
type NewDraftForm = { platform: unknown; format: unknown; topic: unknown; pillar: unknown; campaign: unknown };

// A new draft: written by the AI (withAi: waits for it), or blank (an idea).
export async function createDraftThroughCore(form: NewDraftForm, withAi: boolean): Promise<CreatedDraftResult> {
  const answer = await callCore<{ draftId: string }>("POST", "/api/v1/cofounder/drafts", {
    platform: text(form.platform),
    format: text(form.format),
    topic: text(form.topic),
    pillar: text(form.pillar),
    campaign: text(form.campaign),
    withAi,
  });
  return answer.ok ? { ok: true, draftId: answer.data.draftId } : { ok: false, errors: toFormErrors(answer) };
}

// The editor's fields, as typed (the hashtags too: "#bread #lisbon").
type EditForm = {
  draftId: unknown;
  version: unknown;
  topic: unknown;
  pillar: unknown;
  campaign: unknown;
  title: unknown;
  body: unknown;
  hashtags: unknown;
  callToAction: unknown;
  imagePrompt: unknown;
  videoScript: unknown;
};

// An edit of the draft as the editor opened it (its version).
export async function editDraftThroughCore(form: EditForm): Promise<FormResult> {
  return postToDraft(form.draftId, "edit", {
    version: versionNumber(form.version),
    topic: text(form.topic),
    pillar: text(form.pillar),
    campaign: text(form.campaign),
    title: text(form.title),
    body: text(form.body),
    hashtags: text(form.hashtags),
    callToAction: text(form.callToAction),
    imagePrompt: text(form.imagePrompt),
    videoScript: text(form.videoScript),
  });
}

// New text from the AI as the next version (waits for it); refused when
// the page shows an older version.
export async function regenerateDraftThroughCore(draftId: unknown, version: unknown): Promise<FormResult> {
  return postToDraft(draftId, "regenerate", { version: versionNumber(version) });
}

// Owners: the version they read; claimsChecked is the "I checked these claims" tick ("on").
export async function approveDraftThroughCore(draftId: unknown, version: unknown, claimsChecked: unknown): Promise<FormResult> {
  return postToDraft(draftId, "approve", { version: versionNumber(version), claimsChecked: claimsChecked === "on" });
}

// Owners: the version they read, with an optional note (blank = none).
export async function rejectDraftThroughCore(draftId: unknown, version: unknown, note: unknown): Promise<FormResult> {
  return postToDraft(draftId, "reject", { version: versionNumber(version), note: text(note) });
}

export async function archiveDraftThroughCore(draftId: unknown): Promise<FormResult> {
  return postToDraft(draftId, "archive", {});
}

export async function restoreDraftThroughCore(draftId: unknown): Promise<FormResult> {
  return postToDraft(draftId, "restore", {});
}

async function postToDraft(draftId: unknown, change: string, body: Record<string, unknown>): Promise<FormResult> {
  const path = draftPath(draftId);
  if (!path) {
    return { ok: false, errors: UNKNOWN_DRAFT };
  }
  return savedOrErrors(await callCore("POST", `${path}/${change}`, body));
}
