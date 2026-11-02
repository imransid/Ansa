"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addDishThroughCore,
  confirmMenuReadingThroughCore,
  deleteDishThroughCore,
  moveDishThroughCore,
  readMenuThroughCore,
  setDishAvailabilityThroughCore,
  updateDishThroughCore,
} from "@/lib/core-views/menu";
import { withTypedValues, type FormErrors, type SaveState } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import type { MenuReadingOutcome } from "@/lib/types/menu-reading";

// Thin, like every action: core checks the person, the input and the
// rate limits. A refused form gets back what was typed. Each uses the new
// backend when it is switched on (lib/core-api.ts), else services/.

const DISH_FIELDS = ["category", "name", "description", "price"];

function dishFrom(formData: FormData) {
  return Object.fromEntries(DISH_FIELDS.map((name) => [name, formData.get(name)]));
}

export async function addMenuItemAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  await requireSessionContext();
  const result = await addDishThroughCore(dishFrom(formData));
  if (!result.ok) {
    return { errors: withTypedValues(result.errors, formData, DISH_FIELDS) };
  }
  revalidatePath("/settings/menu");
  return { saved: true };
}

export async function updateMenuItemAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  await requireSessionContext();
  const result = await updateDishThroughCore(formData.get("itemId"), dishFrom(formData));
  if (!result.ok) {
    return { errors: withTypedValues(result.errors, formData, DISH_FIELDS) };
  }
  revalidatePath("/settings/menu");
  return { saved: true };
}

export async function deleteMenuItemAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await deleteDishThroughCore(formData.get("itemId"));
  if (!result.ok) {
    return result.errors;
  }
  revalidatePath("/settings/menu");
  return undefined;
}

export async function moveMenuItemAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await moveDishThroughCore(formData.get("itemId"), formData.get("direction"));
  if (!result.ok) {
    return result.errors;
  }
  revalidatePath("/settings/menu");
  return undefined;
}

export async function setMenuItemAvailabilityAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await setDishAvailabilityThroughCore(formData.get("itemId"), formData.get("available"));
  if (!result.ok) {
    return result.errors;
  }
  revalidatePath("/settings/menu");
  return undefined;
}

// "Read my menu": the list for the owner to check. Saves nothing.
export async function readMenuAction(formData: FormData): Promise<MenuReadingOutcome> {
  await requireSessionContext();
  const file = formData.get("file");
  const text = formData.get("text");
  const source = { file: file instanceof File ? file : null, text: typeof text === "string" ? text : null };
  return readMenuThroughCore(source);
}

// "Looks right": adds the checked dishes, then back to the menu.
export async function addCheckedMenuReadingAction(items: unknown): Promise<FormErrors> {
  await requireSessionContext();
  const result = await confirmMenuReadingThroughCore(items);
  if (!result.ok) {
    return result.errors;
  }
  revalidatePath("/settings/menu");
  redirect("/settings/menu?added=1");
}
