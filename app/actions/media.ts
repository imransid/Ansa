"use server";

import { revalidatePath } from "next/cache";
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

// Server actions are public POST endpoints. Keep them thin: read the form,
// ask core (which checks company, input and rate limits), refresh the
// Co-Founder's pages. Core makes an image or video by itself after its
// answer. A refused form gets back what was typed, so it can show it again.

export async function uploadMediaAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  await requireSessionContext();
  const result = await uploadMediaThroughCore(formData.get("file"), formData.get("altText"));
  return describeSave(result, formData, ["altText"]);
}

export async function saveMediaAltTextAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  await requireSessionContext();
  const result = await saveAltTextThroughCore(formData.get("assetId"), formData.get("altText"));
  return describeSave(result, formData, ["altText"]);
}

export async function deleteMediaAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  return refreshOrReturnErrors(await deleteMediaThroughCore(formData.get("assetId")));
}

export async function generateMediaAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await requestGenerationThroughCore(formData.get("kind"), formData.get("prompt"));
  if (!result.ok) {
    return withTypedValues(result.errors, formData, ["kind", "prompt"]);
  }
  refreshCoFounderPages();
  return undefined;
}

export async function cancelGenerationAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  return refreshOrReturnErrors(await cancelGenerationThroughCore(formData.get("jobId")));
}

// The request is claimed before the answer, so the page sent back shows it being made.
export async function startGenerationNowAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  return refreshOrReturnErrors(await startGenerationThroughCore(formData.get("jobId")));
}

// A draft's page: attach an image or video (assetId), or take it off (assetId "").
export async function setDraftMediaAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const input = { draftId: formData.get("draftId"), version: formData.get("version"), assetId: formData.get("assetId") };
  return refreshOrReturnErrors(await setDraftMediaThroughCore(input.draftId, input.version, input.assetId));
}

// A draft's page: "Make the image with the AI" from its image description.
export async function generateDraftImageAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const input = { draftId: formData.get("draftId"), version: formData.get("version") };
  return refreshOrReturnErrors(await requestDraftImageThroughCore(input.draftId, input.version));
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
