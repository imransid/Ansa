"use server";

import { revalidatePath } from "next/cache";
import { discardCommentReplyThroughCore, saveCommentSettingsThroughCore, sendCommentReplyThroughCore } from "@/lib/core-views/comments";
import type { FormErrors, SaveState } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";

// Thin, like every action: core checks the person, that the comment is the
// company's and still waiting, and the rate limit.

// ansa's waiting texts for a comment ("Ask me first"), sent as written (anyone in the company).
export async function sendCommentReplyAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await sendCommentReplyThroughCore(String(formData.get("commentId") ?? ""));
  // Refreshed either way: a reply that no longer waits shows what became of it.
  revalidatePath("/inbox", "layout");
  return result.ok ? undefined : result.errors;
}

// ansa's waiting texts for a comment, discarded: they never go out.
export async function discardCommentReplyAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await discardCommentReplyThroughCore(String(formData.get("commentId") ?? ""));
  revalidatePath("/inbox", "layout");
  return result.ok ? undefined : result.errors;
}

// Settings → Connections: whether ansa answers comments on the Page's posts (owners; core refuses members).
export async function saveCommentSettingsAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  await requireSessionContext();
  const result = await saveCommentSettingsThroughCore(formData.get("answerComments") === "on");
  if (!result.ok) {
    return { errors: result.errors };
  }
  revalidatePath("/settings/channels");
  revalidatePath("/inbox/comments");
  return { saved: true };
}
