import "server-only";
import { z } from "zod";
import { getContentDraftForCompany } from "@/db/content-drafts";
import { getGenerationJobsForCompany, getOpenGenerationJobForDraft, type GenerationJobListItem } from "@/db/media-generation-jobs";
import { createGenerationJob, type CreateJobOutcome } from "@/db/media-generation-requests";
import { EDITABLE_STATUSES, mediaKindOfFormat } from "@/lib/content-studio/draft-fields";
import type { FormErrors } from "@/lib/form-result";
import type { MediaKind } from "@/lib/media/kinds";
import { GENERATION_JOBS_SHOWN } from "@/lib/media/limits";
import { currentMediaGenerationMode } from "@/lib/media-generation";
import type { SessionContext } from "@/lib/session";
import { draftGenerationSchema, generationRequestSchema } from "@/lib/validation/media";
import { getLibraryPagesOfAssets, isMediaLibraryFullForRequests, MEDIA_LIBRARY_FULL_MESSAGE } from "./media-library";
import { runGenerationJob, type GenerationRunOptions } from "./media-generation-runs";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// Asking for images and videos (step 39): from the media page's "Generate
// an image", or from a draft's image description (the result is attached
// to that draft). Each request is saved first, then run right after the
// page's answer (runAfterResponse: Next's after()), so nobody waits on the
// image service. Everyone in the company may ask, within the company's
// daily limit. Nothing is asked for while generation is off. Cancel and
// "Start now": services/media-generation-control.ts.

// One request as the media page lists it: libraryPage is the page of the
// library that shows what it made (null: nothing, or deleted since).
export type GenerationJobListEntry = GenerationJobListItem & { libraryPage: number | null };

// Hands work to after(): the route passes (task) => after(task).
export type RunAfterResponse = (task: () => Promise<unknown>) => void;

export type GenerationRequestResult = { ok: true; jobId: string } | { ok: false; errors: FormErrors };

export const GENERATION_OFF_MESSAGE = "Image generation isn't set up yet, so nothing was asked for.";

// What the pages say about image generation on this server: whether anyone
// can be asked, whether that is the development stand-in, and whether it
// makes videos too.
export type GenerationAvailability = { available: boolean; isStandIn: boolean; makesVideo: boolean };

// The availability for this server's own settings (lib/media-generation.ts).
export function describeGenerationAvailability(): GenerationAvailability {
  const mode = currentMediaGenerationMode();
  if (mode.kind === "off") {
    return { available: false, isStandIn: false, makesVideo: false };
  }
  return { available: true, isStandIn: mode.provider.isStandIn, makesVideo: mode.provider.kinds.includes("video") };
}

// The session company's newest requests, newest first, each with the page
// of the library that shows what it made.
export async function listGenerationJobsForSession(session: SessionContext): Promise<GenerationJobListEntry[]> {
  const jobs = await getGenerationJobsForCompany(session.companyId, GENERATION_JOBS_SHOWN);
  const pages = await getLibraryPagesOfAssets(session.companyId, jobs.flatMap((job) => (job.assetId ? [job.assetId] : [])));
  return jobs.map((job) => ({ ...job, libraryPage: job.assetId ? (pages.get(job.assetId) ?? null) : null }));
}

// "Generate an image" on the media page: the kind and the prompt.
export async function requestGenerationForSession(
  session: SessionContext,
  input: unknown,
  runAfterResponse: RunAfterResponse,
  options: GenerationRunOptions = {},
): Promise<GenerationRequestResult> {
  const parsed = generationRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  return createAndRun(session, { ...parsed.data, draft: null }, runAfterResponse, options);
}

// "Make the image with the AI" on a post with an image: from the draft's
// saved image description, at the version the page showed, attached to the
// draft once it is made (as its next version, without any approval) while
// the draft is still at that version. The common refusals come first, so
// they don't count against the daily limit; /db checks them all again.
export async function requestDraftImageForSession(
  session: SessionContext,
  input: unknown,
  runAfterResponse: RunAfterResponse,
  options: GenerationRunOptions = {},
): Promise<GenerationRequestResult> {
  const parsed = draftGenerationSchema.safeParse(input);
  if (!parsed.success) {
    return refused("Unknown draft. Reload the page and try again.");
  }
  const draft = await getContentDraftForCompany(session.companyId, parsed.data.draftId);
  if (!draft) {
    return refused("We couldn't find that draft. Reload the page.");
  }
  if (mediaKindOfFormat(draft.format) !== "image") {
    return refused("Only a post with an image gets its image made here. Attach a video from the media library instead.");
  }
  if (!EDITABLE_STATUSES.includes(draft.status)) {
    return refused(describeRefusedJob("draft-not-editable"));
  }
  if (draft.version !== parsed.data.version) {
    return refused(describeRefusedJob("draft-stale"));
  }
  if (!draft.imagePrompt.trim()) {
    return refused("Describe the image first (Image: what it shows), and save.");
  }
  const open = await getOpenGenerationJobForDraft(session.companyId, draft.id);
  if (open && !open.isStuck) {
    return refused(describeRefusedJob("draft-busy"));
  }
  const request = { kind: "image" as const, prompt: draft.imagePrompt, draft: { id: draft.id, version: draft.version } };
  return createAndRun(session, request, runAfterResponse, options);
}

// Saves the request for the session's company and runs it after the answer.
async function createAndRun(
  session: SessionContext,
  request: { kind: MediaKind; prompt: string; draft: { id: string; version: number } | null },
  runAfterResponse: RunAfterResponse,
  options: GenerationRunOptions,
): Promise<GenerationRequestResult> {
  const mode = options.mode ?? currentMediaGenerationMode();
  if (mode.kind === "off") {
    return refused(GENERATION_OFF_MESSAGE);
  }
  // Per company: each will be a paid request once a real service is chosen.
  if (await isOverRateLimit("media-generations", session.companyId, RATE_LIMITS.mediaGenerationsPerCompany)) {
    return refused("Your company reached its limit of 30 images and videos a day. Try again tomorrow.");
  }
  if (await isMediaLibraryFullForRequests(session.companyId)) {
    return refused(MEDIA_LIBRARY_FULL_MESSAGE);
  }
  const created = await createGenerationJob(session.companyId, session.userId, { ...request, provider: mode.provider.name });
  if (created.outcome !== "created") {
    return refused(describeRefusedJob(created.outcome));
  }
  runAfterResponse(() => runGenerationJob(session.companyId, created.jobId, options));
  return { ok: true, jobId: created.jobId };
}

// What the page says when the request can't be saved.
function describeRefusedJob(outcome: Exclude<CreateJobOutcome["outcome"], "created">): string {
  switch (outcome) {
    case "not-allowed":
      return "You can't add media to this company.";
    case "draft-not-found":
      return "We couldn't find that draft. Reload the page.";
    case "draft-wrong-format":
      return "This draft takes no image of this kind.";
    case "draft-not-editable":
      return "This draft's status changed meanwhile (an archived draft must be restored first). Reload the page to see it.";
    case "draft-stale":
      return "Someone changed this draft after you opened it, so nothing was asked for. Reload the page to see their change.";
    case "draft-busy":
      return "An image for this draft is already being made.";
  }
}

// A refusal with this message.
function refused(message: string): { ok: false; errors: FormErrors } {
  return { ok: false, errors: { message } };
}
