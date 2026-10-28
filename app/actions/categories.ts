"use server";

import { revalidatePath } from "next/cache";
import { withTypedValues, type FormErrors, type FormResult, type SaveState } from "@/lib/form-result";
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
// A refused form gets back what was typed, so it can show it again.

export async function createCategoryAction(_previous: FormErrors | undefined, formData: FormData) {
  const session = await requireSessionContext();
  const result = await createCategoryForSession(session, { name: formData.get("name") });
  return refreshOrReturnErrors(result, formData, ["name"]);
}

export async function renameCategoryAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  const session = await requireSessionContext();
  const result = await renameCategoryForSession(session, { categoryId: formData.get("categoryId"), name: formData.get("name") });
  return describeSave(refreshOrReturnErrors(result, formData, ["name"]));
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

export async function setTicketCategoryAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  const session = await requireSessionContext();
  const result = await setTicketCategoryForSession(session, { ticketId: formData.get("ticketId"), category: formData.get("category") });
  return describeSave(refreshOrReturnErrors(result, formData, ["category"]));
}

function refreshOrReturnErrors(result: FormResult, formData?: FormData, typedFields: string[] = []): FormErrors | undefined {
  if (!result.ok) {
    return formData ? withTypedValues(result.errors, formData, typedFields) : result.errors;
  }
  revalidatePath("/team");
  revalidatePath("/dashboard");
  revalidatePath("/setup");
  revalidatePath("/tickets/[ticketNumber]", "page");
  return undefined;
}

// For inline "Save" forms, which say "Saved" when it worked.
function describeSave(errors: FormErrors | undefined): SaveState {
  return errors ? { errors } : { saved: true };
}
