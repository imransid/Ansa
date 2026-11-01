"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isCoreOn } from "@/lib/core-api";
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
// Each uses the new backend when it is switched on (lib/core-api.ts), else
// services/; both answer in the same shapes.

export async function assignTicketAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = isCoreOn()
    ? await assignRequestThroughCore(formText(formData, "ticketId"), formText(formData, "assigneeUserId"))
    : await assignTicketForSession(session, {
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
  const result = isCoreOn()
    ? await solveRequestThroughCore(formText(formData, "ticketId"), formText(formData, "confirmedCustomerEmail"))
    : await markTicketSolvedForSession(session, {
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
  const result = isCoreOn()
    ? await closeRequestThroughCore(formText(formData, "ticketId"))
    : await closeTicketWithoutEmailForSession(session, {
        ticketId: formData.get("ticketId"),
      });
  return refreshTicketPagesOrReturnErrors(result);
}

export async function reopenTicketAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = isCoreOn()
    ? await reopenRequestThroughCore(formText(formData, "ticketId"))
    : await reopenTicketForSession(session, {
        ticketId: formData.get("ticketId"),
      });
  return refreshTicketPagesOrReturnErrors(result);
}

export async function retryCustomerEmailAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  // Core names the request in the address too (the form's ticketId).
  const result = isCoreOn()
    ? await retryEmailThroughCore(formText(formData, "ticketId"), formText(formData, "emailId"), formData.get("confirmPossibleDuplicate") === "yes")
    : await retryCustomerEmailForSession(session, {
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
  const result = isCoreOn()
    ? await setCustomerEmailThroughCore(formText(formData, "ticketId"), formText(formData, "customerEmail"), formData.get("confirmed") === "yes")
    : await setCustomerEmailForSession(session, {
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
  const result = isCoreOn()
    ? await createRequestThroughCore({
        subject: formText(formData, "subject"),
        description: formText(formData, "description"),
        customerName: formText(formData, "customerName"),
        customerEmail: formText(formData, "customerEmail"),
        customerPhone: formText(formData, "customerPhone"),
        categoryId: formText(formData, "categoryId"),
        customerEmailConfirmed: formData.get("customerEmailConfirmed") === "yes",
      })
    : await createManualTicketForSession(session, {
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
  revalidatePath("/inbox", "layout");
  // redirect() works by throwing, so this must never sit inside a try/catch.
  redirect(`/tickets/${result.ticketNumber}`);
}

export async function editTicketDetailsAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = isCoreOn()
    ? await editRequestThroughCore(formText(formData, "ticketId"), {
        subject: formText(formData, "subject"),
        customerName: formText(formData, "customerName"),
        originalSubject: formText(formData, "originalSubject"),
        originalCustomerName: formText(formData, "originalCustomerName"),
      })
    : await editTicketDetailsForSession(session, {
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
  const result = isCoreOn()
    ? await addRequestNoteThroughCore(formText(formData, "ticketId"), formText(formData, "body"))
    : await addTicketNoteForSession(session, {
        ticketId: formData.get("ticketId"),
        body: formData.get("body"),
      });
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
