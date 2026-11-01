"use server";

import { revalidatePath } from "next/cache";
import { isCoreOn } from "@/lib/core-api";
import { makeTicketFromEmailThroughCore, processEmailAgainThroughCore } from "@/lib/core-views/emails";
import type { FormErrors, FormResult } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import { makeTicketFromEmailForSession, processEmailAgainForSession } from "@/services/inbound-email-actions";

// Server actions are public POST endpoints. Keep them thin: read the form,
// call a service (which checks company and rate limits), refresh pages. Each
// uses the new backend when it is switched on (lib/core-api.ts), else services/.

export async function processEmailAgainAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = isCoreOn()
    ? await processEmailAgainThroughCore(String(formData.get("inboundEmailId") ?? ""))
    : await processEmailAgainForSession(session, { inboundEmailId: formData.get("inboundEmailId") });
  return refreshEmailPagesAndReturnErrors(result);
}

export async function makeTicketFromEmailAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = isCoreOn()
    ? await makeTicketFromEmailThroughCore(String(formData.get("inboundEmailId") ?? ""))
    : await makeTicketFromEmailForSession(session, { inboundEmailId: formData.get("inboundEmailId") });
  return refreshEmailPagesAndReturnErrors(result);
}

// Refreshed even when it didn't become a ticket: the email's new status shows why.
function refreshEmailPagesAndReturnErrors(result: FormResult): FormErrors | undefined {
  revalidatePath("/emails");
  revalidatePath("/dashboard");
  revalidatePath("/inbox", "layout");
  return result.ok ? undefined : result.errors;
}
