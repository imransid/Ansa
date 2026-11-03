import "server-only";
import { callCore, type CoreAnswer } from "@/lib/core-api";
import { toFormErrors } from "@/lib/core-views/auth";
import { MAX_DOCUMENT_BYTES, TOO_BIG_MESSAGE } from "@/lib/document-files";
import type { FormResult } from "@/lib/form-result";
import type { ProposedMenuItem } from "@/lib/menu-reading/answer";
import type { MenuItemRow, MenuView } from "@/lib/types/menu";
import type { MenuReadingOutcome } from "@/lib/types/menu-reading";

// The Menu pages and "Read my menu" through the new backend (core's
// /api/v1/menu), in the shapes the pages and their actions already read.

// A form value as the forms send it: text, or nothing.
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// A dish's address in core.
function dishPath(itemId: unknown): string {
  return `/api/v1/menu/items/${encodeURIComponent(text(itemId))}`;
}

// One dish as typed in the add and edit forms (and each row of a checked
// reading): its category, name, description and price.
type TypedDish = Record<string, unknown>;

function typedDish(dish: TypedDish): { category: string; name: string; description: string; price: string } {
  return { category: text(dish.category), name: text(dish.name), description: text(dish.description), price: text(dish.price) };
}

function savedOrErrors(answer: CoreAnswer<unknown>): FormResult {
  return answer.ok ? { ok: true } : { ok: false, errors: toFormErrors(answer) };
}

// The dishes, the currency (null until one is chosen) and whether this person edits the menu.
export async function getMenuFromCore(): Promise<MenuView> {
  const answer = await callCore<{ items: MenuItemRow[]; currency: string; canEdit: boolean }>("GET", "/api/v1/menu");
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  return { items: answer.data.items, currency: answer.data.currency || null, canEdit: answer.data.canEdit };
}

export async function addDishThroughCore(dish: TypedDish): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", "/api/v1/menu/items", typedDish(dish)));
}

export async function updateDishThroughCore(itemId: unknown, dish: TypedDish): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", dishPath(itemId), typedDish(dish)));
}

export async function deleteDishThroughCore(itemId: unknown): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", `${dishPath(itemId)}/delete`));
}

// direction: "up" or "down", within its category.
export async function moveDishThroughCore(itemId: unknown, direction: unknown): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", `${dishPath(itemId)}/move`, { direction: text(direction) }));
}

// available: the form's "true" (back on the menu) or "false" (not available today).
export async function setDishAvailabilityThroughCore(itemId: unknown, available: unknown): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", `${dishPath(itemId)}/availability`, { available: text(available) === "true" }));
}

// "Read my menu": a photo or file (as base64), else the pasted text. Saves nothing.
export async function readMenuThroughCore(source: { file: File | null; text: string | null }): Promise<MenuReadingOutcome> {
  let body: { fileName: string; data: string } | { text: string } = { text: source.text ?? "" };
  if (source.file && source.file.size > 0) {
    // WHY here: a bigger file, as base64, passes core's body limit and
    // would get a bare refusal instead of these words.
    if (source.file.size > MAX_DOCUMENT_BYTES) {
      return { ok: false, message: TOO_BIG_MESSAGE };
    }
    body = { fileName: source.file.name, data: Buffer.from(await source.file.arrayBuffer()).toString("base64") };
  }
  const answer = await callCore<{ items: ProposedMenuItem[]; dropped: number; standIn: boolean; textCut: boolean }>("POST", "/api/v1/menu/read", body);
  if (!answer.ok) {
    return { ok: false, message: answer.message };
  }
  return { ok: true, items: answer.data.items, dropped: answer.data.dropped, standIn: answer.data.standIn, textCut: answer.data.textCut };
}

// "Looks right": every dish of the reading as the owner left it, all or none.
export async function confirmMenuReadingThroughCore(items: unknown): Promise<FormResult> {
  const rows: unknown[] = Array.isArray(items) ? items : [];
  const dishes = rows.map((row) => typedDish(typeof row === "object" && row !== null ? (row as TypedDish) : {}));
  return savedOrErrors(await callCore("POST", "/api/v1/menu/reading/confirm", { items: dishes }));
}
