"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isCoreOn } from "@/lib/core-api";
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
import {
  addCheckedMenuReadingForSession,
  addMenuItemForSession,
  deleteMenuItemForSession,
  moveMenuItemForSession,
  setMenuItemAvailabilityForSession,
  updateMenuItemForSession,
} from "@/services/menu";
import { readMenuForSession } from "@/services/menu-reading";

// Thin, like every action: the services check the person, the input and the
// rate limits. A refused form gets back what was typed. Each uses the new
// backend when it is switched on (lib/core-api.ts), else services/.

const DISH_FIELDS = ["category", "name", "description", "price"];

function dishFrom(formData: FormData) {
  return Object.fromEntries(DISH_FIELDS.map((name) => [name, formData.get(name)]));
}

export async function addMenuItemAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  const session = await requireSessionContext();
  const result = isCoreOn() ? await addDishThroughCore(dishFrom(formData)) : await addMenuItemForSession(session, dishFrom(formData));
  if (!result.ok) {
    return { errors: withTypedValues(result.errors, formData, DISH_FIELDS) };
  }
  revalidatePath("/settings/menu");
  return { saved: true };
}

export async function updateMenuItemAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  const session = await requireSessionContext();
  const result = isCoreOn()
    ? await updateDishThroughCore(formData.get("itemId"), dishFrom(formData))
    : await updateMenuItemForSession(session, { ...dishFrom(formData), itemId: formData.get("itemId") });
  if (!result.ok) {
    return { errors: withTypedValues(result.errors, formData, DISH_FIELDS) };
  }
  revalidatePath("/settings/menu");
  return { saved: true };
}

export async function deleteMenuItemAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = isCoreOn() ? await deleteDishThroughCore(formData.get("itemId")) : await deleteMenuItemForSession(session, { itemId: formData.get("itemId") });
  if (!result.ok) {
    return result.errors;
  }
  revalidatePath("/settings/menu");
  return undefined;
}

export async function moveMenuItemAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = isCoreOn()
    ? await moveDishThroughCore(formData.get("itemId"), formData.get("direction"))
    : await moveMenuItemForSession(session, { itemId: formData.get("itemId"), direction: formData.get("direction") });
  if (!result.ok) {
    return result.errors;
  }
  revalidatePath("/settings/menu");
  return undefined;
}

export async function setMenuItemAvailabilityAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = isCoreOn()
    ? await setDishAvailabilityThroughCore(formData.get("itemId"), formData.get("available"))
    : await setMenuItemAvailabilityForSession(session, { itemId: formData.get("itemId"), available: formData.get("available") });
  if (!result.ok) {
    return result.errors;
  }
  revalidatePath("/settings/menu");
  return undefined;
}

// "Read my menu": the list for the owner to check. Saves nothing.
export async function readMenuAction(formData: FormData): Promise<MenuReadingOutcome> {
  const session = await requireSessionContext();
  const file = formData.get("file");
  const text = formData.get("text");
  const source = { file: file instanceof File ? file : null, text: typeof text === "string" ? text : null };
  return isCoreOn() ? readMenuThroughCore(source) : readMenuForSession(session, source);
}

// "Looks right": adds the checked dishes, then back to the menu.
export async function addCheckedMenuReadingAction(items: unknown): Promise<FormErrors> {
  const session = await requireSessionContext();
  const result = isCoreOn() ? await confirmMenuReadingThroughCore(items) : await addCheckedMenuReadingForSession(session, { items });
  if (!result.ok) {
    return result.errors;
  }
  revalidatePath("/settings/menu");
  redirect("/settings/menu?added=1");
}
