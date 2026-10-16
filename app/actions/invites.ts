"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormErrors } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import { joinCompanyWithInvite } from "@/services/auth";
import {
  createInviteForSession,
  getInvitePreview,
  revokeInviteForSession,
  type InvitePreview,
} from "@/services/invites";

// Server actions are public POST endpoints. Keep them thin: read the input,
// call a service (which checks the role, validates and rate limits), respond.

export type CreateInviteState = {
  inviteLink?: string;
  errors?: FormErrors;
};

export async function createInviteAction(
  _previousState: CreateInviteState | undefined,
  formData: FormData,
): Promise<CreateInviteState> {
  const session = await requireSessionContext();
  const result = await createInviteForSession(session, {
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!result.ok) {
    return { errors: result.errors };
  }
  revalidatePath("/team");
  return { inviteLink: result.inviteLink };
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  const session = await requireSessionContext();
  await revokeInviteForSession(session, { inviteId: formData.get("inviteId") });
  revalidatePath("/team");
}

export async function getInvitePreviewAction(
  inviteToken: string,
): Promise<InvitePreview | null> {
  return getInvitePreview(inviteToken);
}

export async function joinWithInviteAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  const result = await joinCompanyWithInvite({
    inviteToken: formData.get("inviteToken"),
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!result.ok) {
    return result.errors;
  }
  redirect("/dashboard");
}
