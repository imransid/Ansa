"use server";

import { revalidatePath } from "next/cache";
import type { FormErrors, FormResult } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import { retryCustomerEmailForSession } from "@/services/customer-emails";
import {
  assignTicketForSession,
  markTicketSolvedForSession,
  reopenTicketForSession,
} from "@/services/tickets";

// Server actions are public POST endpoints. Keep them thin: read the form,
// call a service (which checks company, role and rate limits), refresh pages.

export async function assignTicketAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await assignTicketForSession(session, {
    ticketId: formData.get("ticketId"),
    assigneeUserId: formData.get("assigneeUserId"),
  });
  return refreshTicketPagesOrReturnErrors(result);
}

export async function markTicketSolvedAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await markTicketSolvedForSession(session, {
    ticketId: formData.get("ticketId"),
  });
  return refreshTicketPagesOrReturnErrors(result);
}

export async function reopenTicketAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await reopenTicketForSession(session, {
    ticketId: formData.get("ticketId"),
  });
  return refreshTicketPagesOrReturnErrors(result);
}

export async function retryCustomerEmailAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await retryCustomerEmailForSession(session, {
    emailId: formData.get("emailId"),
  });
  return refreshTicketPagesOrReturnErrors(result);
}

function refreshTicketPagesOrReturnErrors(
  result: FormResult,
): FormErrors | undefined {
  if (!result.ok) {
    return result.errors;
  }
  revalidatePath("/dashboard");
  revalidatePath("/tickets/[ticketNumber]", "page");
  return undefined;
}
