"use server";

import { revalidatePath } from "next/cache";
import type { FormErrors, FormResult } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import { changeTeammateRoleForSession, removeTeammateForSession } from "@/services/team";

// Server actions are public POST endpoints. Keep them thin: read the form,
// call a service (which checks role, company and rate limits), refresh pages.

export async function removeTeammateAction(_previous: FormErrors | undefined, formData: FormData) {
  const session = await requireSessionContext();
  return refreshOrReturnErrors(await removeTeammateForSession(session, { userId: formData.get("userId") }));
}

export async function changeTeammateRoleAction(_previous: FormErrors | undefined, formData: FormData) {
  const session = await requireSessionContext();
  return refreshOrReturnErrors(
    await changeTeammateRoleForSession(session, { userId: formData.get("userId"), role: formData.get("role") }),
  );
}

// Removing someone routes their open tickets again, so ticket pages change too.
function refreshOrReturnErrors(result: FormResult): FormErrors | undefined {
  if (!result.ok) {
    return result.errors;
  }
  revalidatePath("/team");
  revalidatePath("/dashboard");
  revalidatePath("/tickets/[ticketNumber]", "page");
  return undefined;
}
