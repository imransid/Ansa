"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { isCoreOn } from "@/lib/core-api";
import { deleteMediaThroughCore, saveAltTextThroughCore, uploadMediaThroughCore } from "@/lib/core-views/media";
import {
  cancelGenerationThroughCore,
  requestDraftImageThroughCore,
  requestGenerationThroughCore,
  setDraftMediaThroughCore,
  startGenerationThroughCore,
} from "@/lib/core-views/media-generation";
import { withTypedValues, type FormErrors, type FormResult, type SaveState } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import { setDraftMediaForSession } from "@/services/draft-media";
import { cancelGenerationForSession, startStuckGenerationForSession } from "@/services/media-generation-control";
import { requestDraftImageForSession, requestGenerationForSession } from "@/services/media-generation-jobs";
import { deleteMediaForSession } from "@/services/media-deletion";
import { saveMediaAltTextForSession, uploadMediaForSession } from "@/services/media-library";

// Server actions are public POST endpoints. Keep them thin: read the form,
// call a service (which checks company, input and rate limits), refresh the
// Co-Founder's pages. An image or video is made after the answer, through
// Next's after(), within the page's 300 seconds (maxDuration); with the new
// backend switched on (lib/core-api.ts), core makes it after its own answer.
// A refused form gets back what was typed, so it can show it again.

const runAfterResponse = (task: () => Promise<unknown>) => after(task);

export async function uploadMediaAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  const session = await requireSessionContext();
  const result = isCoreOn()
    ? await uploadMediaThroughCore(formData.get("file"), formData.get("altText"))
    : await uploadMediaForSession(session, { file: formData.get("file"), altText: formData.get("altText") });
  return describeSave(result, formData, ["altText"]);
}

export async function saveMediaAltTextAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  const session = await requireSessionContext();
  const result = isCoreOn()
    ? await saveAltTextThroughCore(formData.get("assetId"), formData.get("altText"))
    : await saveMediaAltTextForSession(session, { assetId: formData.get("assetId"), altText: formData.get("altText") });
  return describeSave(result, formData, ["altText"]);
}

export async function deleteMediaAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  if (isCoreOn()) {
    return refreshOrReturnErrors(await deleteMediaThroughCore(formData.get("assetId")));
  }
  return refreshOrReturnErrors(await deleteMediaForSession(session, { assetId: formData.get("assetId") }));
}

export async function generateMediaAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = isCoreOn()
    ? await requestGenerationThroughCore(formData.get("kind"), formData.get("prompt"))
    : await requestGenerationForSession(session, { kind: formData.get("kind"), prompt: formData.get("prompt") }, runAfterResponse);
  if (!result.ok) {
    return withTypedValues(result.errors, formData, ["kind", "prompt"]);
  }
  refreshCoFounderPages();
  return undefined;
}

export async function cancelGenerationAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  if (isCoreOn()) {
    return refreshOrReturnErrors(await cancelGenerationThroughCore(formData.get("jobId")));
  }
  return refreshOrReturnErrors(await cancelGenerationForSession(session, { jobId: formData.get("jobId") }));
}

// The request is claimed before the answer, so the page sent back shows it being made.
export async function startGenerationNowAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  if (isCoreOn()) {
    return refreshOrReturnErrors(await startGenerationThroughCore(formData.get("jobId")));
  }
  return refreshOrReturnErrors(await startStuckGenerationForSession(session, { jobId: formData.get("jobId") }, runAfterResponse));
}

// A draft's page: attach an image or video (assetId), or take it off (assetId "").
export async function setDraftMediaAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const input = { draftId: formData.get("draftId"), version: formData.get("version"), assetId: formData.get("assetId") };
  if (isCoreOn()) {
    return refreshOrReturnErrors(await setDraftMediaThroughCore(input.draftId, input.version, input.assetId));
  }
  return refreshOrReturnErrors(await setDraftMediaForSession(session, input));
}

// A draft's page: "Make the image with the AI" from its image description.
export async function generateDraftImageAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const input = { draftId: formData.get("draftId"), version: formData.get("version") };
  if (isCoreOn()) {
    return refreshOrReturnErrors(await requestDraftImageThroughCore(input.draftId, input.version));
  }
  const result = await requestDraftImageForSession(session, input, runAfterResponse);
  return refreshOrReturnErrors(result.ok ? { ok: true } : result);
}

function describeSave(result: FormResult, formData: FormData, typedFields: string[]): SaveState {
  if (!result.ok) {
    return { errors: withTypedValues(result.errors, formData, typedFields) };
  }
  refreshCoFounderPages();
  return { saved: true };
}

function refreshOrReturnErrors(result: FormResult): FormErrors | undefined {
  if (!result.ok) {
    return result.errors;
  }
  refreshCoFounderPages();
  return undefined;
}

// Every page under /cofounder: the media library and each draft's page.
function refreshCoFounderPages(): void {
  revalidatePath("/cofounder", "layout");
}
