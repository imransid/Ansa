"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { analyzeCallThroughCore, escalateCallThroughCore } from "@/lib/core-views/calls";
import type { FormErrors } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";

// Server actions are public POST endpoints. Keep them thin: read the form,
// ask core (which checks company and rate limits), refresh pages.
// Each uses the new backend when it is switched on (lib/core-api.ts), else
// services/; both answer in the same shapes.

export async function analyzeCallAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const input = { callId: formData.get("callId") };
  const result = await analyzeCallThroughCore(input);
  if (!result.ok) {
    return result.errors;
  }
  revalidatePath("/calls");
  revalidatePath("/calls/[callId]", "page");
  return undefined;
}

// "Escalate to a ticket" on a call the AI marked solved (step 31): on
// success, opens the new ticket's page.
export async function escalateCallAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const input = {
    callId: formData.get("callId"),
    categoryId: formData.get("categoryId"),
    note: formData.get("note"),
  };
  const result = await escalateCallThroughCore(input);
  // Refreshed even when the escalation was refused: usually a teammate
  // escalated this call a moment before, and the page must swap the form for
  // their ticket.
  revalidatePath("/calls");
  revalidatePath("/calls/[callId]", "page");
  if (!result.ok) {
    return result.errors;
  }
  revalidatePath("/dashboard");
  revalidatePath("/inbox", "layout");
  // redirect() works by throwing, so this must never sit inside a try/catch.
  redirect(`/tickets/${result.ticketNumber}`);
}
