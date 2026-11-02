"use server";

import { revalidatePath } from "next/cache";
import {
  addSupportAddressThroughCore,
  deleteDocumentThroughCore,
  removeSupportAddressThroughCore,
  setCompanyNameThroughCore,
  setReplyToEmailThroughCore,
  uploadDocumentThroughCore,
} from "@/lib/core-views/support-setup";
import { withTypedValues, type FormErrors, type FormResult, type SaveState } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";

// Thin, like every action: core checks owner role, input and rate limits.
// There are no phone number actions: ansa links numbers (pnpm link:phone-line).
// A refused form gets back what was typed, so it can show it again. Each
// uses the new backend when it is switched on (lib/core-api.ts), else services/.

export async function setCompanyNameAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  await requireSessionContext();
  const result = await setCompanyNameThroughCore(formData.get("companyName"));
  return describeSave(refreshOrReturnErrors(result, formData, ["companyName"]));
}

export async function setReplyToEmailAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  await requireSessionContext();
  const result = await setReplyToEmailThroughCore(formData.get("replyToEmail"));
  return describeSave(refreshOrReturnErrors(result, formData, ["replyToEmail"]));
}

export async function addInboundAddressAction(_previous: FormErrors | undefined, formData: FormData) {
  await requireSessionContext();
  const result = await addSupportAddressThroughCore(formData.get("address"));
  return refreshOrReturnErrors(result, formData, ["address"]);
}

export async function removeInboundAddressAction(_previous: FormErrors | undefined, formData: FormData) {
  await requireSessionContext();
  return refreshOrReturnErrors(await removeSupportAddressThroughCore(formData.get("value")));
}

export async function uploadDocumentAction(_previous: FormErrors | undefined, formData: FormData) {
  await requireSessionContext();
  return refreshOrReturnErrors(await uploadDocumentThroughCore(formData.get("file")));
}

export async function deleteDocumentAction(_previous: FormErrors | undefined, formData: FormData) {
  await requireSessionContext();
  return refreshOrReturnErrors(await deleteDocumentThroughCore(formData.get("documentId")));
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
