"use server";

import { revalidatePath } from "next/cache";
import type { FormErrors, FormResult } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import { deleteDocumentForSession, uploadDocumentForSession } from "@/services/documents";
import {
  addInboundAddressForSession,
  addPhoneLineForSession,
  removeInboundAddressForSession,
  removePhoneLineForSession,
  setReplyToEmailForSession,
} from "@/services/setup";

// Thin, like every action: the services check owner role, input and rate limits.

export async function setReplyToEmailAction(_previous: FormErrors | undefined, formData: FormData) {
  const session = await requireSessionContext();
  return refreshOrReturnErrors(await setReplyToEmailForSession(session, { replyToEmail: formData.get("replyToEmail") }));
}

export async function addPhoneLineAction(_previous: FormErrors | undefined, formData: FormData) {
  const session = await requireSessionContext();
  return refreshOrReturnErrors(await addPhoneLineForSession(session, { vapiPhoneNumberId: formData.get("vapiPhoneNumberId") }));
}

export async function addInboundAddressAction(_previous: FormErrors | undefined, formData: FormData) {
  const session = await requireSessionContext();
  return refreshOrReturnErrors(await addInboundAddressForSession(session, { address: formData.get("address") }));
}

export async function removePhoneLineAction(_previous: FormErrors | undefined, formData: FormData) {
  const session = await requireSessionContext();
  return refreshOrReturnErrors(await removePhoneLineForSession(session, { vapiPhoneNumberId: formData.get("value") }));
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

function refreshOrReturnErrors(result: FormResult): FormErrors | undefined {
  if (!result.ok) {
    return result.errors;
  }
  revalidatePath("/setup");
  return undefined;
}
