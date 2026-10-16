"use server";

import { revalidatePath } from "next/cache";
import type { FormErrors } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import { analyzeCallForSession } from "@/services/call-analysis";

// Server actions are public POST endpoints. Keep them thin: read the form,
// call a service (which checks company and rate limits), refresh pages.

export async function analyzeCallAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await analyzeCallForSession(session, { callId: formData.get("callId") });
  if (!result.ok) {
    return result.errors;
  }
  revalidatePath("/calls");
  revalidatePath("/calls/[callId]", "page");
  return undefined;
}
