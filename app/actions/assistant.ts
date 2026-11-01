"use server";

import { revalidatePath } from "next/cache";
import { isCoreOn } from "@/lib/core-api";
import { saveAiEngineThroughCore, testAssistantThroughCore } from "@/lib/core-views/assistant";
import type { SaveState } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import { saveAiEngineForSession } from "@/services/assistant-engine-settings";
import { testAssistantForSession, type AssistantTestResult } from "@/services/assistant-test";

// Thin, like every action (step 49): the services check the person, the
// input and the rate limits. The API key is never sent back to the form,
// refused or not.

export async function saveAiEngineAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  const session = await requireSessionContext();
  // The new backend when it is switched on (lib/core-api.ts), else services/.
  const result = isCoreOn()
    ? await saveAiEngineThroughCore(formData)
    : await saveAiEngineForSession(session, {
        engine: formData.get("engine"),
        apiKey: formData.get("apiKey"),
        removeKey: formData.get("removeKey"),
      });
  revalidatePath("/settings/assistant");
  return result.ok ? { saved: true } : { errors: result.errors };
}

export async function testAssistantAction(_previous: AssistantTestResult | undefined, formData: FormData): Promise<AssistantTestResult> {
  const session = await requireSessionContext();
  if (isCoreOn()) {
    return testAssistantThroughCore(formData);
  }
  return testAssistantForSession(session, { text: formData.get("text") });
}
