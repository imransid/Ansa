"use server";

import { revalidatePath } from "next/cache";
import {
  markAwaySummarySeenThroughCore,
  saveAnswerWhenThroughCore,
  setAssistantStatusThroughCore,
  setAwayThroughCore,
  setImportantThroughCore,
} from "@/lib/core-views/home";
import type { FormErrors, SaveState } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";

// Thin, like every action (step 51): core checks the person, the
// input and the rate limits.

export async function setAwayAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await setAwayThroughCore(formData.get("away"));
  revalidatePath("/", "layout");
  return result.ok ? undefined : result.errors;
}

export async function setAssistantStatusAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await setAssistantStatusThroughCore(formData.get("status"));
  revalidatePath("/", "layout");
  return result.ok ? undefined : result.errors;
}

export async function saveAnswerWhenAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  await requireSessionContext();
  const result = await saveAnswerWhenThroughCore(formData.get("answerWhen"));
  revalidatePath("/", "layout");
  return result.ok ? { saved: true } : { errors: result.errors };
}

export async function markAwaySummarySeenAction(): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await markAwaySummarySeenThroughCore();
  revalidatePath("/dashboard");
  return result.ok ? undefined : result.errors;
}

export async function setImportantAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await setImportantThroughCore(formData.get("conversationId"), formData.get("important"));
  revalidatePath("/inbox", "layout");
  return result.ok ? undefined : result.errors;
}
