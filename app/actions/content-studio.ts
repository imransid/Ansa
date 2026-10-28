"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormErrors, FormResult, SaveState } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import { editDraftForSession } from "@/services/content-draft-edits";
import { createBlankDraftForSession } from "@/services/content-drafts";
import { generateDraftForSession, regenerateDraftForSession } from "@/services/content-generation";
import { approveDraftForSession, archiveDraftForSession, rejectDraftForSession, restoreDraftForSession } from "@/services/content-review";

// Server actions are public POST endpoints. Keep them thin: read the form,
// call a service (which checks company, role, input and rate limits),
// refresh the Co-Founder's pages.

// "New draft": "Write it with the AI" or "Start blank" (the button sends
// mode). On success it opens the new draft (a redirect), so it never returns.
export async function createDraftAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const input = {
    platform: formData.get("platform"),
    format: formData.get("format"),
    topic: formData.get("topic"),
    pillar: formData.get("pillar"),
    campaign: formData.get("campaign"),
  };
  const result = formData.get("mode") === "blank" ? await createBlankDraftForSession(session, input) : await generateDraftForSession(session, input);
  if (!result.ok) {
    return result.errors;
  }
  refreshCoFounderPages();
  // redirect() works by throwing, so this must never sit inside a try/catch.
  redirect(`/cofounder/studio/${result.draftId}`);
}

export async function editDraftAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  const session = await requireSessionContext();
  const result = await editDraftForSession(session, {
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
  });
  if (!result.ok) {
    return { errors: result.errors };
  }
  refreshCoFounderPages();
  return { saved: true };
}

export async function regenerateDraftAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const input = { draftId: formData.get("draftId"), version: formData.get("version") };
  return refreshOrReturnErrors(await regenerateDraftForSession(session, input));
}

export async function approveDraftAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const input = { draftId: formData.get("draftId"), version: formData.get("version"), claimsChecked: formData.get("claimsChecked") };
  const result = await approveDraftForSession(session, input);
  // Refreshed after a refusal too: the approval reviews the draft against
  // the facts as they are now, so it can refuse for a change made after the
  // page loaded (a fact behind a claim, a new word to avoid). The page must
  // then show it, with the "I checked these claims" box when it is needed.
  refreshCoFounderPages();
  return result.ok ? undefined : result.errors;
}

export async function rejectDraftAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const input = { draftId: formData.get("draftId"), version: formData.get("version"), note: formData.get("note") };
  return refreshOrReturnErrors(await rejectDraftForSession(session, input));
}

export async function archiveDraftAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  return refreshOrReturnErrors(await archiveDraftForSession(session, { draftId: formData.get("draftId") }));
}

export async function restoreDraftAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  return refreshOrReturnErrors(await restoreDraftForSession(session, { draftId: formData.get("draftId") }));
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
