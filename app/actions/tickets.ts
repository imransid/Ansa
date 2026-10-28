"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormErrors, FormResult } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import { retryCustomerEmailForSession } from "@/services/customer-emails";
import { createManualTicketForSession } from "@/services/manual-tickets";
import { addTicketNoteForSession } from "@/services/ticket-history";
import {
  closeTicketWithoutEmailForSession,
  markTicketSolvedForSession,
  reopenTicketForSession,
} from "@/services/ticket-status";
import { assignTicketForSession, editTicketDetailsForSession, setCustomerEmailForSession } from "@/services/tickets";

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
    confirmedCustomerEmail: formData.get("confirmedCustomerEmail"),
  });
  // Refreshed even when the solve was refused: the ticket was solved by
  // someone else meanwhile, or its customer email just changed, and the page
  // must show that.
  refreshTicketPages();
  return result.ok ? undefined : result.errors;
}

export async function closeTicketWithoutEmailAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await closeTicketWithoutEmailForSession(session, {
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
    confirmPossibleDuplicate: formData.get("confirmPossibleDuplicate"),
  });
  return refreshTicketPagesOrReturnErrors(result);
}

export async function setCustomerEmailAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await setCustomerEmailForSession(session, {
    ticketId: formData.get("ticketId"),
    customerEmail: formData.get("customerEmail"),
    confirmed: formData.get("confirmed"),
  });
  return refreshTicketPagesOrReturnErrors(result);
}

// "New ticket" (step 31): on success, opens the new ticket's page.
export async function createManualTicketAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await createManualTicketForSession(session, {
    subject: formData.get("subject"),
    description: formData.get("description"),
    customerName: formData.get("customerName"),
    customerEmail: formData.get("customerEmail"),
    customerPhone: formData.get("customerPhone"),
    categoryId: formData.get("categoryId"),
    customerEmailConfirmed: formData.get("customerEmailConfirmed"),
  });
  if (!result.ok) {
    return result.errors;
  }
  revalidatePath("/dashboard");
  // redirect() works by throwing, so this must never sit inside a try/catch.
  redirect(`/tickets/${result.ticketNumber}`);
}

export async function editTicketDetailsAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await editTicketDetailsForSession(session, {
    ticketId: formData.get("ticketId"),
    subject: formData.get("subject"),
    customerName: formData.get("customerName"),
    originalSubject: formData.get("originalSubject"),
    originalCustomerName: formData.get("originalCustomerName"),
  });
  return refreshTicketPagesOrReturnErrors(result);
}

export async function addTicketNoteAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await addTicketNoteForSession(session, {
    ticketId: formData.get("ticketId"),
    body: formData.get("body"),
  });
  return refreshTicketPagesOrReturnErrors(result);
}

function refreshTicketPagesOrReturnErrors(
  result: FormResult,
): FormErrors | undefined {
  if (!result.ok) {
    return result.errors;
  }
  refreshTicketPages();
  return undefined;
}

function refreshTicketPages(): void {
  revalidatePath("/dashboard");
  revalidatePath("/tickets/[ticketNumber]", "page");
  // Its "Customer emails not delivered" list changes with solves and retries.
  revalidatePath("/emails");
}
