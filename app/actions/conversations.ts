"use server";

import { revalidatePath } from "next/cache";
import { isCoreOn } from "@/lib/core-api";
import {
  discardDraftThroughCore,
  finishChatRequestThroughCore,
  handBackThroughCore,
  replyThroughCore,
  sendDraftThroughCore,
  takeOverThroughCore,
} from "@/lib/core-views/inbox";
import { withTypedValues, type FormErrors, type SaveState } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import { discardDraftForSession, sendDraftForSession } from "@/services/assistant-drafts";
import { finishChatRequestForSession } from "@/services/conversation-done";
import { handBackForSession, replyForSession, takeOverForSession } from "@/services/conversations";

// Thin, like every action: the services check the person, the input and the
// rate limit. A refused reply gets back what was typed. Each uses the new
// backend when it is switched on (lib/core-api.ts), else services/.

export async function takeOverAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = isCoreOn()
    ? await takeOverThroughCore(String(formData.get("conversationId") ?? ""))
    : await takeOverForSession(session, { conversationId: formData.get("conversationId") });
  revalidatePath("/inbox", "layout");
  return result.ok ? undefined : result.errors;
}

export async function handBackAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = isCoreOn()
    ? await handBackThroughCore(String(formData.get("conversationId") ?? ""))
    : await handBackForSession(session, { conversationId: formData.get("conversationId") });
  revalidatePath("/inbox", "layout");
  return result.ok ? undefined : result.errors;
}

export async function finishChatRequestAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = isCoreOn()
    ? await finishChatRequestThroughCore(String(formData.get("conversationId") ?? ""), String(formData.get("ticketId") ?? ""))
    : await finishChatRequestForSession(session, { ticketId: formData.get("ticketId"), conversationId: formData.get("conversationId") });
  revalidatePath("/", "layout");
  return result.ok ? undefined : result.errors;
}

export async function replyAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  const session = await requireSessionContext();
  const result = isCoreOn()
    ? await replyThroughCore(
        String(formData.get("conversationId") ?? ""),
        String(formData.get("text") ?? ""),
        String(formData.get("replacesDraftId") ?? ""),
      )
    : await replyForSession(session, {
        conversationId: formData.get("conversationId"),
        text: formData.get("text"),
        replacesDraftId: formData.get("replacesDraftId"),
      });
  revalidatePath("/inbox", "layout");
  if (!result.ok) {
    return { errors: withTypedValues(result.errors, formData, ["text"]) };
  }
  return { saved: true };
}

// The assistant's waiting replies ("Ask me first", step 49).
export async function sendDraftAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = isCoreOn()
    ? await sendDraftThroughCore(String(formData.get("conversationId") ?? ""), String(formData.get("messageId") ?? ""))
    : await sendDraftForSession(session, { conversationId: formData.get("conversationId"), messageId: formData.get("messageId") });
  revalidatePath("/inbox", "layout");
  return result.ok ? undefined : result.errors;
}

export async function discardDraftAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = isCoreOn()
    ? await discardDraftThroughCore(String(formData.get("conversationId") ?? ""), String(formData.get("messageId") ?? ""))
    : await discardDraftForSession(session, { conversationId: formData.get("conversationId"), messageId: formData.get("messageId") });
  revalidatePath("/inbox", "layout");
  return result.ok ? undefined : result.errors;
}
