"use server";

import { revalidatePath } from "next/cache";
import {
  answerNowThroughCore,
  discardDraftThroughCore,
  finishChatRequestThroughCore,
  handBackThroughCore,
  replyThroughCore,
  sendDraftThroughCore,
  takeOverThroughCore,
} from "@/lib/core-views/inbox";
import { withTypedValues, type FormErrors, type SaveState } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";

// Thin, like every action: core checks the person, the input and the rate
// limit. A refused reply gets back what was typed.

export async function takeOverAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await takeOverThroughCore(String(formData.get("conversationId") ?? ""));
  revalidatePath("/inbox", "layout");
  return result.ok ? undefined : result.errors;
}

export async function handBackAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await handBackThroughCore(String(formData.get("conversationId") ?? ""));
  revalidatePath("/inbox", "layout");
  return result.ok ? undefined : result.errors;
}

export async function finishChatRequestAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await finishChatRequestThroughCore(String(formData.get("conversationId") ?? ""), String(formData.get("ticketId") ?? ""));
  revalidatePath("/", "layout");
  return result.ok ? undefined : result.errors;
}

export async function replyAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  await requireSessionContext();
  const result = await replyThroughCore(
        String(formData.get("conversationId") ?? ""),
        String(formData.get("text") ?? ""),
        String(formData.get("replacesDraftId") ?? ""),
      );
  revalidatePath("/inbox", "layout");
  if (!result.ok) {
    return { errors: withTypedValues(result.errors, formData, ["text"]) };
  }
  return { saved: true };
}

// The assistant's waiting replies ("Ask me first", step 49).
export async function sendDraftAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await sendDraftThroughCore(String(formData.get("conversationId") ?? ""), String(formData.get("messageId") ?? ""));
  revalidatePath("/inbox", "layout");
  return result.ok ? undefined : result.errors;
}

export async function discardDraftAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await discardDraftThroughCore(String(formData.get("conversationId") ?? ""), String(formData.get("messageId") ?? ""));
  revalidatePath("/inbox", "layout");
  return result.ok ? undefined : result.errors;
}

// "Answer now" while ansa waits for a person's reply (development only, step 51).
export async function answerNowAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await answerNowThroughCore(String(formData.get("conversationId") ?? ""));
  revalidatePath("/inbox", "layout");
  return result.ok ? undefined : result.errors;
}
