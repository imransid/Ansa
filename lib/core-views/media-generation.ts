import "server-only";
import { callCore, type CoreAnswer } from "@/lib/core-api";
import { toFormErrors } from "@/lib/core-views/auth";
import { draftPath, versionNumber } from "@/lib/core-views/studio";
import type { FormResult } from "@/lib/form-result";
import { generationJobIdSchema, mediaAssetIdSchema } from "@/lib/validation/media";

// Asking for images and videos, and a draft's media, through the new
// backend (core's /api/v1/media/generations and a draft's media and image):
// answering as the services did (FormResult). Core saves a request, then
// makes it right after its answer, on its own: nothing waits here.

// A form value as the forms send it: text, or nothing.
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function savedOrErrors(answer: CoreAnswer<unknown>): FormResult {
  return answer.ok ? { ok: true } : { ok: false, errors: toFormErrors(answer) };
}

function refused(message: string): FormResult {
  return { ok: false, errors: { message } };
}

// "Generate an image" on the media page: the kind and the prompt.
export async function requestGenerationThroughCore(kind: unknown, prompt: unknown): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", "/api/v1/media/generations", { kind: text(kind), prompt: text(prompt) }));
}

// A request's address in core, or null when the id (a claim from a form) isn't a uuid.
function requestPath(jobId: unknown): string | null {
  const parsed = generationJobIdSchema.safeParse({ jobId });
  return parsed.success ? `/api/v1/media/generations/${parsed.data.jobId}` : null;
}

// Cancel: only while it waits to start.
export async function cancelGenerationThroughCore(jobId: unknown): Promise<FormResult> {
  const path = requestPath(jobId);
  return path ? savedOrErrors(await callCore("POST", `${path}/cancel`, {})) : refused("Unknown request. Reload the page.");
}

// "Start now" on a stuck request: core claims it before its answer, so the
// page sent back shows it being made. One it gave up on ("interrupted") is
// done too: the refreshed page says so in plain words.
export async function startGenerationThroughCore(jobId: unknown): Promise<FormResult> {
  const path = requestPath(jobId);
  return path ? savedOrErrors(await callCore("POST", `${path}/start`, {})) : refused("Unknown request. Reload the page.");
}

// A draft's page: attach one of the library's images or videos (assetId),
// or take it off (assetId ""), as the version the page showed.
export async function setDraftMediaThroughCore(draftId: unknown, version: unknown, assetId: unknown): Promise<FormResult> {
  const path = draftPath(draftId);
  const asset = pickedAsset(assetId);
  if (!path || asset === null) {
    return refused("Unknown draft or image. Reload the page and try again.");
  }
  return savedOrErrors(await callCore("POST", `${path}/media`, { version: versionNumber(version), assetId: asset }));
}

// The asset picked: "" takes it off; else a uuid, or null when it isn't one.
function pickedAsset(assetId: unknown): string | null {
  if (assetId === "") {
    return "";
  }
  const parsed = mediaAssetIdSchema.safeParse({ assetId });
  return parsed.success ? parsed.data.assetId : null;
}

// A draft's page: "Make the image with the AI" from its saved image
// description, attached once made while the draft is still at that version.
export async function requestDraftImageThroughCore(draftId: unknown, version: unknown): Promise<FormResult> {
  const path = draftPath(draftId);
  if (!path) {
    return refused("Unknown draft. Reload the page and try again.");
  }
  return savedOrErrors(await callCore("POST", `${path}/image`, { version: versionNumber(version) }));
}
