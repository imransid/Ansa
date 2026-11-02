"use server";

import { revalidatePath } from "next/cache";
import {
  createCategoryThroughCore,
  renameCategoryThroughCore,
  setCategoryArchivedThroughCore,
  setTicketCategoryThroughCore,
  setUserCategoriesThroughCore,
} from "@/lib/core-views/team";
import { withTypedValues, type FormErrors, type FormResult, type SaveState } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";

// Server actions are public POST endpoints. Keep them thin: read the form, ask
// core (which checks role, company and rate limits), refresh pages. A refused
// form gets back what was typed, so it can show it again.

export async function createCategoryAction(_previous: FormErrors | undefined, formData: FormData) {
  await requireSessionContext();
  const result = await createCategoryThroughCore(formData.get("name"));
  return refreshOrReturnErrors(result, formData, ["name"]);
}

export async function renameCategoryAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  await requireSessionContext();
  const result = await renameCategoryThroughCore(formData.get("categoryId"), formData.get("name"));
  return describeSave(refreshOrReturnErrors(result, formData, ["name"]));
}

export async function setCategoryArchivedAction(_previous: FormErrors | undefined, formData: FormData) {
  await requireSessionContext();
  return refreshOrReturnErrors(await setCategoryArchivedThroughCore(formData.get("categoryId"), formData.get("archived")));
}

export async function setUserCategoriesAction(_previous: FormErrors | undefined, formData: FormData) {
  await requireSessionContext();
  return refreshOrReturnErrors(await setUserCategoriesThroughCore(formData.get("userId"), formData.getAll("categoryIds")));
}

export async function setTicketCategoryAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  await requireSessionContext();
  const result = await setTicketCategoryThroughCore(formData.get("ticketId"), formData.get("category"));
  return describeSave(refreshOrReturnErrors(result, formData, ["category"]));
}

function refreshOrReturnErrors(result: FormResult, formData?: FormData, typedFields: string[] = []): FormErrors | undefined {
  if (!result.ok) {
    return formData ? withTypedValues(result.errors, formData, typedFields) : result.errors;
  }
  revalidatePath("/team");
  revalidatePath("/dashboard");
  revalidatePath("/inbox", "layout");
  revalidatePath("/setup");
  revalidatePath("/tickets/[ticketNumber]", "page");
  return undefined;
}

// For inline "Save" forms, which say "Saved" when it worked.
function describeSave(errors: FormErrors | undefined): SaveState {
  return errors ? { errors } : { saved: true };
}
