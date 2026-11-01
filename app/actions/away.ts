"use server";

import { revalidatePath } from "next/cache";
import type { FormErrors, SaveState } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import { markAwaySummarySeenForSession, saveAnswerWhenForSession, setAssistantStatusForSession, setAwayForSession, setImportantForSession } from "@/services/away";

// Thin, like every action (step 51): the services check the person, the
// input and the rate limits.

export async function setAwayAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await setAwayForSession(session, { away: formData.get("away") });
  revalidatePath("/", "layout");
  return result.ok ? undefined : result.errors;
}

export async function setAssistantStatusAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await setAssistantStatusForSession(session, { status: formData.get("status") });
  revalidatePath("/", "layout");
  return result.ok ? undefined : result.errors;
}

export async function saveAnswerWhenAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  const session = await requireSessionContext();
  const result = await saveAnswerWhenForSession(session, { answerWhen: formData.get("answerWhen") });
  revalidatePath("/", "layout");
  return result.ok ? { saved: true } : { errors: result.errors };
}

export async function markAwaySummarySeenAction(): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await markAwaySummarySeenForSession(session);
  revalidatePath("/dashboard");
  return result.ok ? undefined : result.errors;
}

export async function setImportantAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await setImportantForSession(session, { conversationId: formData.get("conversationId"), important: formData.get("important") });
  revalidatePath("/inbox", "layout");
  return result.ok ? undefined : result.errors;
}
