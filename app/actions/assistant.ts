"use server";

import { revalidatePath } from "next/cache";
import { saveAiEngineThroughCore, testAssistantThroughCore } from "@/lib/core-views/assistant";
import type { SaveState } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import type { AssistantTestResult } from "@/lib/types/assistant-test";

// Thin, like every action (step 49): core checks the person, the
// input and the rate limits. The API key is never sent back to the form,
// refused or not.

export async function saveAiEngineAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  await requireSessionContext();
  const result = await saveAiEngineThroughCore(formData);
  revalidatePath("/settings/assistant");
  return result.ok ? { saved: true } : { errors: result.errors };
}

export async function testAssistantAction(_previous: AssistantTestResult | undefined, formData: FormData): Promise<AssistantTestResult> {
  await requireSessionContext();
  return testAssistantThroughCore(formData);
}
