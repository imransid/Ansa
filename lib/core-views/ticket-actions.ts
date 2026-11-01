import "server-only";
import { callCore, type CoreAnswer } from "@/lib/core-api";
import type { FormErrors, FormResult } from "@/lib/form-result";
import type { CreatedTicketResult } from "@/lib/types/manual-tickets";

// A request's (ticket's) actions through the new backend (core's
// /api/v1/requests), answering as the services did (FormResult), and the
// one way every screen of this kind turns core's refusals into form errors.

export async function assignRequestThroughCore(ticketId: string, assigneeUserId: string): Promise<FormResult> {
  return asFormResult(await callCore("POST", requestPath(ticketId, "assign"), { assigneeId: assigneeUserId }));
}

// "Mark as solved": confirmedCustomerEmail is the address the page showed ("" = none).
export async function solveRequestThroughCore(ticketId: string, confirmedCustomerEmail: string): Promise<FormResult> {
  return asFormResult(await callCore("POST", requestPath(ticketId, "solve"), { confirmedCustomerEmail }));
}

export async function closeRequestThroughCore(ticketId: string): Promise<FormResult> {
  return asFormResult(await callCore("POST", requestPath(ticketId, "close")));
}

export async function reopenRequestThroughCore(ticketId: string): Promise<FormResult> {
  return asFormResult(await callCore("POST", requestPath(ticketId, "reopen")));
}

// Retry of a customer email; confirmPossibleDuplicate after "Send it again anyway?".
export async function retryEmailThroughCore(ticketId: string, emailId: string, confirmPossibleDuplicate: boolean): Promise<FormResult> {
  const path = `${requestPath(ticketId, "emails")}/${encodeURIComponent(emailId)}/retry`;
  return asFormResult(await callCore("POST", path, { confirmPossibleDuplicate }));
}

// Saves the customer email the page showed back and the person confirmed.
export async function setCustomerEmailThroughCore(ticketId: string, customerEmail: string, confirmed: boolean): Promise<FormResult> {
  const answer = await callCore<{ saved?: string }>("POST", requestPath(ticketId, "customer-email"), { email: customerEmail, confirmed });
  if (!answer.ok) {
    // Core names the field "email"; the ticket page's is "customerEmail".
    const problem = answer.fields.email;
    return { ok: false, errors: problem ? { fieldErrors: { customerEmail: [problem] } } : { message: answer.message } };
  }
  // Without the confirmation core only answers the address to confirm: nothing was saved.
  return answer.data.saved === undefined ? { ok: false, errors: { message: "Confirm the address before saving" } } : { ok: true };
}

// "Edit subject or customer name", with what the editor opened with.
export async function editRequestThroughCore(
  ticketId: string,
  edit: { subject: string; customerName: string; originalSubject: string; originalCustomerName: string },
): Promise<FormResult> {
  return asFormResult(
    await callCore("POST", requestPath(ticketId, "details"), {
      subject: edit.subject,
      originalSubject: edit.originalSubject,
      customerName: edit.customerName,
      originalCustomerName: edit.originalCustomerName,
    }),
  );
}

// An internal note; a refusal shows under the note box.
export async function addRequestNoteThroughCore(ticketId: string, body: string): Promise<FormResult> {
  return asFormResult(await callCore("POST", requestPath(ticketId, "notes"), { text: body }));
}

// "New ticket": a typed customer email needs the confirm step first.
export async function createRequestThroughCore(input: {
  subject: string;
  description: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  categoryId: string;
  customerEmailConfirmed: boolean;
}): Promise<CreatedTicketResult> {
  const answer = await callCore<{ number: number }>("POST", "/api/v1/requests", {
    subject: input.subject,
    description: input.description,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerEmailConfirmed: input.customerEmailConfirmed,
    customerPhone: input.customerPhone,
    categoryId: input.categoryId,
  });
  return answer.ok ? { ok: true, ticketNumber: answer.data.number } : { ok: false, errors: refusalToFormErrors(answer) };
}

// Core's refusal as a form's errors: a problem under each field it names,
// else its one message at the top of the form.
function refusalToFormErrors(refusal: { message: string; fields: Record<string, string> }): FormErrors {
  const fieldNames = Object.keys(refusal.fields);
  if (fieldNames.length === 0) {
    return { message: refusal.message };
  }
  const fieldErrors: Record<string, string[]> = {};
  for (const name of fieldNames) {
    fieldErrors[name] = [refusal.fields[name]];
  }
  return { fieldErrors };
}

// Core's {} as done, its refusal as the form's errors.
export function asFormResult(answer: CoreAnswer<unknown>): FormResult {
  return answer.ok ? { ok: true } : { ok: false, errors: refusalToFormErrors(answer) };
}

// The id is only a claim from a form: core checks it belongs to the session's company.
function requestPath(ticketId: string, action: string): string {
  return `/api/v1/requests/${encodeURIComponent(ticketId)}/${action}`;
}
