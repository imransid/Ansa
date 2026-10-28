"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormErrors } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import { analyzeCallForSession } from "@/services/call-analysis";
import { escalateCallForSession } from "@/services/call-escalation";

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

// "Escalate to a ticket" on a call the AI marked solved (step 31): on
// success, opens the new ticket's page.
export async function escalateCallAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await escalateCallForSession(session, {
    callId: formData.get("callId"),
    categoryId: formData.get("categoryId"),
    note: formData.get("note"),
  });
  // Refreshed even when the escalation was refused: usually a teammate
  // escalated this call a moment before, and the page must swap the form for
  // their ticket.
  revalidatePath("/calls");
  revalidatePath("/calls/[callId]", "page");
  if (!result.ok) {
    return result.errors;
  }
  revalidatePath("/dashboard");
  // redirect() works by throwing, so this must never sit inside a try/catch.
  redirect(`/tickets/${result.ticketNumber}`);
}
