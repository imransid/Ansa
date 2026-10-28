"use server";

import { revalidatePath } from "next/cache";
import { withTypedValues, type FormErrors, type FormResult, type SaveState } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import { deleteDocumentForSession, uploadDocumentForSession } from "@/services/documents";
import {
  addInboundAddressForSession,
  removeInboundAddressForSession,
  setCompanyNameForSession,
  setReplyToEmailForSession,
} from "@/services/setup";

// Thin, like every action: the services check owner role, input and rate limits.
// There are no phone number actions: ansa links numbers (pnpm link:phone-line).
// A refused form gets back what was typed, so it can show it again.

export async function setCompanyNameAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  const session = await requireSessionContext();
  const result = await setCompanyNameForSession(session, { companyName: formData.get("companyName") });
  return describeSave(refreshOrReturnErrors(result, formData, ["companyName"]));
}

export async function setReplyToEmailAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  const session = await requireSessionContext();
  const result = await setReplyToEmailForSession(session, { replyToEmail: formData.get("replyToEmail") });
  return describeSave(refreshOrReturnErrors(result, formData, ["replyToEmail"]));
}

export async function addInboundAddressAction(_previous: FormErrors | undefined, formData: FormData) {
  const session = await requireSessionContext();
  return refreshOrReturnErrors(await addInboundAddressForSession(session, { address: formData.get("address") }), formData, ["address"]);
}

export async function removeInboundAddressAction(_previous: FormErrors | undefined, formData: FormData) {
  const session = await requireSessionContext();
  return refreshOrReturnErrors(await removeInboundAddressForSession(session, { address: formData.get("value") }));
}

export async function uploadDocumentAction(_previous: FormErrors | undefined, formData: FormData) {
  const session = await requireSessionContext();
  return refreshOrReturnErrors(await uploadDocumentForSession(session, formData.get("file")));
}

export async function deleteDocumentAction(_previous: FormErrors | undefined, formData: FormData) {
  const session = await requireSessionContext();
  return refreshOrReturnErrors(await deleteDocumentForSession(session, { documentId: formData.get("documentId") }));
}

function refreshOrReturnErrors(result: FormResult, formData?: FormData, typedFields: string[] = []): FormErrors | undefined {
  if (!result.ok) {
    return formData ? withTypedValues(result.errors, formData, typedFields) : result.errors;
  }
  revalidatePath("/setup");
  return undefined;
}

// For inline "Save" forms, which say "Saved" when it worked.
function describeSave(errors: FormErrors | undefined): SaveState {
  return errors ? { errors } : { saved: true };
}
