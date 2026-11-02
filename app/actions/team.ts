"use server";

import { revalidatePath } from "next/cache";
import { changeTeammateRoleThroughCore, removeTeammateThroughCore } from "@/lib/core-views/team";
import type { FormErrors, FormResult } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";

// Server actions are public POST endpoints. Keep them thin: read the form,
// ask core (which checks role, company and rate limits), refresh pages.
// Each uses the new backend when it is switched on (lib/core-api.ts), else services/.

export async function removeTeammateAction(_previous: FormErrors | undefined, formData: FormData) {
  await requireSessionContext();
  return refreshOrReturnErrors(await removeTeammateThroughCore(formData.get("userId")));
}

export async function changeTeammateRoleAction(_previous: FormErrors | undefined, formData: FormData) {
  await requireSessionContext();
  return refreshOrReturnErrors(await changeTeammateRoleThroughCore(formData.get("userId"), formData.get("role")));
}

// Removing someone routes their open tickets again, so ticket pages change too.
function refreshOrReturnErrors(result: FormResult): FormErrors | undefined {
  if (!result.ok) {
    return result.errors;
  }
  revalidatePath("/team");
  revalidatePath("/dashboard");
  revalidatePath("/inbox", "layout");
  revalidatePath("/tickets/[ticketNumber]", "page");
  return undefined;
}
