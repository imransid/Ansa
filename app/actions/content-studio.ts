"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  approveDraftThroughCore,
  archiveDraftThroughCore,
  createDraftThroughCore,
  editDraftThroughCore,
  regenerateDraftThroughCore,
  rejectDraftThroughCore,
  restoreDraftThroughCore,
} from "@/lib/core-views/studio";
import type { FormErrors, FormResult, SaveState } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";

// Server actions are public POST endpoints. Keep them thin: read the form, ask
// core (which checks company, role, input and rate limits), refresh the
// Co-Founder's pages.

// "New draft": "Write it with the AI" or "Start blank" (the button sends
// mode). On success it opens the new draft (a redirect), so it never returns.
export async function createDraftAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const input = {
    platform: formData.get("platform"),
    format: formData.get("format"),
    topic: formData.get("topic"),
    pillar: formData.get("pillar"),
    campaign: formData.get("campaign"),
  };
  const isBlank = formData.get("mode") === "blank";
  const result = await createDraftThroughCore(input, !isBlank);
  if (!result.ok) {
    return result.errors;
  }
  refreshCoFounderPages();
  // redirect() works by throwing, so this must never sit inside a try/catch.
  redirect(`/cofounder/studio/${result.draftId}`);
}

export async function editDraftAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  await requireSessionContext();
  const input = {
    draftId: formData.get("draftId"),
    version: formData.get("version"),
    topic: formData.get("topic"),
    pillar: formData.get("pillar"),
    campaign: formData.get("campaign"),
    title: formData.get("title"),
    body: formData.get("body"),
    hashtags: formData.get("hashtags"),
    callToAction: formData.get("callToAction"),
    imagePrompt: formData.get("imagePrompt"),
    videoScript: formData.get("videoScript"),
  };
  const result = await editDraftThroughCore(input);
  if (!result.ok) {
    return { errors: result.errors };
  }
  refreshCoFounderPages();
  return { saved: true };
}

export async function regenerateDraftAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const input = { draftId: formData.get("draftId"), version: formData.get("version") };
  return refreshOrReturnErrors(await regenerateDraftThroughCore(input.draftId, input.version));
}

export async function approveDraftAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const input = { draftId: formData.get("draftId"), version: formData.get("version"), claimsChecked: formData.get("claimsChecked") };
  const result = await approveDraftThroughCore(input.draftId, input.version, input.claimsChecked);
  // Refreshed after a refusal too: the approval reviews the draft against
  // the facts as they are now, so it can refuse for a change made after the
  // page loaded (a fact behind a claim, a new word to avoid). The page must
  // then show it, with the "I checked these claims" box when it is needed.
  refreshCoFounderPages();
  return result.ok ? undefined : result.errors;
}

export async function rejectDraftAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const input = { draftId: formData.get("draftId"), version: formData.get("version"), note: formData.get("note") };
  return refreshOrReturnErrors(await rejectDraftThroughCore(input.draftId, input.version, input.note));
}

export async function archiveDraftAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  return refreshOrReturnErrors(await archiveDraftThroughCore(formData.get("draftId")));
}

export async function restoreDraftAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  return refreshOrReturnErrors(await restoreDraftThroughCore(formData.get("draftId")));
}

function refreshOrReturnErrors(result: FormResult): FormErrors | undefined {
  if (!result.ok) {
    return result.errors;
  }
  refreshCoFounderPages();
  return undefined;
}

// Every page under /cofounder: the studio's list and each draft's page.
function refreshCoFounderPages(): void {
  revalidatePath("/cofounder", "layout");
}
