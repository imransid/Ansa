"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addRequestNoteThroughCore,
  assignRequestThroughCore,
  closeRequestThroughCore,
  createRequestThroughCore,
  editRequestThroughCore,
  reopenRequestThroughCore,
  retryEmailThroughCore,
  setCustomerEmailThroughCore,
  solveRequestThroughCore,
} from "@/lib/core-views/ticket-actions";
import type { FormErrors, FormResult } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";

// Server actions are public POST endpoints. Keep them thin: read the form,
// ask core (which checks company, role and rate limits), refresh pages.
// Each uses the new backend when it is switched on (lib/core-api.ts), else
// services/; both answer in the same shapes.

export async function assignTicketAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await assignRequestThroughCore(formText(formData, "ticketId"), formText(formData, "assigneeUserId"));
  return refreshTicketPagesOrReturnErrors(result);
}

export async function markTicketSolvedAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await solveRequestThroughCore(formText(formData, "ticketId"), formText(formData, "confirmedCustomerEmail"));
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
  await requireSessionContext();
  const result = await closeRequestThroughCore(formText(formData, "ticketId"));
  return refreshTicketPagesOrReturnErrors(result);
}

export async function reopenTicketAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await reopenRequestThroughCore(formText(formData, "ticketId"));
  return refreshTicketPagesOrReturnErrors(result);
}

export async function retryCustomerEmailAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  await requireSessionContext();
  // Core names the request in the address too (the form's ticketId).
  const result = await retryEmailThroughCore(formText(formData, "ticketId"), formText(formData, "emailId"), formData.get("confirmPossibleDuplicate") === "yes");
  return refreshTicketPagesOrReturnErrors(result);
}

export async function setCustomerEmailAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await setCustomerEmailThroughCore(formText(formData, "ticketId"), formText(formData, "customerEmail"), formData.get("confirmed") === "yes");
  return refreshTicketPagesOrReturnErrors(result);
}

// "New ticket" (step 31): on success, opens the new ticket's page.
export async function createManualTicketAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await createRequestThroughCore({
        subject: formText(formData, "subject"),
        description: formText(formData, "description"),
        customerName: formText(formData, "customerName"),
        customerEmail: formText(formData, "customerEmail"),
        customerPhone: formText(formData, "customerPhone"),
        categoryId: formText(formData, "categoryId"),
        customerEmailConfirmed: formData.get("customerEmailConfirmed") === "yes",
      });
  if (!result.ok) {
    return result.errors;
  }
  revalidatePath("/dashboard");
  revalidatePath("/inbox", "layout");
  // redirect() works by throwing, so this must never sit inside a try/catch.
  redirect(`/tickets/${result.ticketNumber}`);
}

export async function editTicketDetailsAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await editRequestThroughCore(formText(formData, "ticketId"), {
        subject: formText(formData, "subject"),
        customerName: formText(formData, "customerName"),
        originalSubject: formText(formData, "originalSubject"),
        originalCustomerName: formText(formData, "originalCustomerName"),
      });
  return refreshTicketPagesOrReturnErrors(result);
}

export async function addTicketNoteAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await addRequestNoteThroughCore(formText(formData, "ticketId"), formText(formData, "body"));
  return refreshTicketPagesOrReturnErrors(result);
}

// A form field as text for the new backend ("" when missing).
function formText(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "");
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
  revalidatePath("/inbox", "layout");
  revalidatePath("/tickets/[ticketNumber]", "page");
  // Its "Customer emails not delivered" list changes with solves and retries.
  revalidatePath("/emails");
}
