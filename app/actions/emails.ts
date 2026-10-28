"use server";

import { revalidatePath } from "next/cache";
import type { FormErrors, FormResult } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import { makeTicketFromEmailForSession, processEmailAgainForSession } from "@/services/inbound-email-actions";

// Server actions are public POST endpoints. Keep them thin: read the form,
// call a service (which checks company and rate limits), refresh pages.

export async function processEmailAgainAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await processEmailAgainForSession(session, { inboundEmailId: formData.get("inboundEmailId") });
  return refreshEmailPagesAndReturnErrors(result);
}

export async function makeTicketFromEmailAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await makeTicketFromEmailForSession(session, { inboundEmailId: formData.get("inboundEmailId") });
  return refreshEmailPagesAndReturnErrors(result);
}

// Refreshed even when it didn't become a ticket: the email's new status shows why.
function refreshEmailPagesAndReturnErrors(result: FormResult): FormErrors | undefined {
  revalidatePath("/emails");
  revalidatePath("/dashboard");
  return result.ok ? undefined : result.errors;
}
