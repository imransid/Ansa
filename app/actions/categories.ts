"use server";

import { revalidatePath } from "next/cache";
import type { FormErrors, FormResult } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import {
  createCategoryForSession,
  renameCategoryForSession,
  setCategoryArchivedForSession,
  setTicketCategoryForSession,
  setUserCategoriesForSession,
} from "@/services/categories";

// Server actions are public POST endpoints. Keep them thin: read the form,
// call a service (which checks role, company and rate limits), refresh pages.

export async function createCategoryAction(_previous: FormErrors | undefined, formData: FormData) {
  const session = await requireSessionContext();
  return refreshOrReturnErrors(await createCategoryForSession(session, { name: formData.get("name") }));
}

export async function renameCategoryAction(_previous: FormErrors | undefined, formData: FormData) {
  const session = await requireSessionContext();
  return refreshOrReturnErrors(
    await renameCategoryForSession(session, { categoryId: formData.get("categoryId"), name: formData.get("name") }),
  );
}

export async function setCategoryArchivedAction(_previous: FormErrors | undefined, formData: FormData) {
  const session = await requireSessionContext();
  return refreshOrReturnErrors(
    await setCategoryArchivedForSession(session, { categoryId: formData.get("categoryId"), archived: formData.get("archived") }),
  );
}

export async function setUserCategoriesAction(_previous: FormErrors | undefined, formData: FormData) {
  const session = await requireSessionContext();
  return refreshOrReturnErrors(
    await setUserCategoriesForSession(session, { userId: formData.get("userId"), categoryIds: formData.getAll("categoryIds") }),
  );
}

export async function setTicketCategoryAction(_previous: FormErrors | undefined, formData: FormData) {
  const session = await requireSessionContext();
  return refreshOrReturnErrors(
    await setTicketCategoryForSession(session, { ticketId: formData.get("ticketId"), category: formData.get("category") }),
  );
}

function refreshOrReturnErrors(result: FormResult): FormErrors | undefined {
  if (!result.ok) {
    return result.errors;
  }
  revalidatePath("/team");
  revalidatePath("/dashboard");
  revalidatePath("/tickets/[ticketNumber]", "page");
  return undefined;
}
