"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getInvitePreviewFromCore, joinThroughCore } from "@/lib/core-views/auth";
import { createInviteThroughCore, revokeInviteThroughCore } from "@/lib/core-views/team";
import { withTypedValues, type FormErrors } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import type { InvitePreviewResult } from "@/lib/types/invites";

// Server actions are public POST endpoints. Keep them thin: read the input,
// ask core (which checks the role, validates and rate limits), respond. A
// refused form gets back what was typed, never the password (withTypedValues).

export type CreateInviteState = {
  inviteLink?: string;
  errors?: FormErrors;
};

export async function createInviteAction(
  _previousState: CreateInviteState | undefined,
  formData: FormData,
): Promise<CreateInviteState> {
  await requireSessionContext();
  const input = { email: formData.get("email"), role: formData.get("role") };
  const result = await createInviteThroughCore(input);
  if (!result.ok) {
    return { errors: withTypedValues(result.errors, formData, ["email", "role"]) };
  }
  revalidatePath("/team");
  return { inviteLink: result.inviteLink };
}

// The errors when the invite could not be revoked (the page shows them next
// to it), or undefined when its link no longer works.
export async function revokeInviteAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await revokeInviteThroughCore(formData.get("inviteId"));
  // Refreshed either way: "no longer pending" means it was used or revoked
  // meanwhile, and the list must show that.
  revalidatePath("/team");
  return result.ok ? undefined : result.errors;
}

export async function getInvitePreviewAction(
  inviteToken: string,
): Promise<InvitePreviewResult> {
  return getInvitePreviewFromCore(inviteToken);
}

export async function joinWithInviteAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  const input = {
    inviteToken: formData.get("inviteToken"),
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  };
  const result = await joinThroughCore(input);
  if (!result.ok) {
    return withTypedValues(result.errors, formData, ["name"]);
  }
  // No session yet: the email address must be confirmed first (step 12).
  redirect("/check-email");
}
