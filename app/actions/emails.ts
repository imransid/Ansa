"use server";

import { revalidatePath } from "next/cache";
import { makeTicketFromEmailThroughCore, processEmailAgainThroughCore } from "@/lib/core-views/emails";
import type { FormErrors, FormResult } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";

// Server actions are public POST endpoints. Keep them thin: read the form, ask
// core (which checks company and rate limits), refresh pages.

export async function processEmailAgainAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await processEmailAgainThroughCore(String(formData.get("inboundEmailId") ?? ""));
  return refreshEmailPagesAndReturnErrors(result);
}

export async function makeTicketFromEmailAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await makeTicketFromEmailThroughCore(String(formData.get("inboundEmailId") ?? ""));
  return refreshEmailPagesAndReturnErrors(result);
}

// Refreshed even when it didn't become a ticket: the email's new status shows why.
function refreshEmailPagesAndReturnErrors(result: FormResult): FormErrors | undefined {
  revalidatePath("/emails");
  revalidatePath("/dashboard");
  revalidatePath("/inbox", "layout");
  return result.ok ? undefined : result.errors;
}
