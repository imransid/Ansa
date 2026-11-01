import "server-only";
import { z } from "zod";
import { getAssistantSettings } from "@/db/assistant-settings";
import { addMenuItems, deleteMenuItem, listMenuItems, moveMenuItem, setMenuItemAvailability, updateMenuItem } from "@/db/menu";
import type { MenuItemFields, MenuItemRow, MenuWriteOutcome } from "@/db/menu";

export type { MenuItemRow };
import type { FormResult } from "@/lib/form-result";
import { MENU_ITEMS_MAX, parsePrice } from "@/lib/menu";
import { endOfLocalDay } from "@/lib/opening-hours";
import { canEditMenu, canMarkMenuAvailability } from "@/lib/restaurant-permissions";
import type { SessionContext } from "@/lib/session";
import {
  confirmMenuReadingSchema,
  editMenuItemSchema,
  menuAvailabilitySchema,
  menuItemFieldsSchema,
  menuItemIdInputSchema,
  moveMenuItemSchema,
} from "@/lib/validation/menu";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// The restaurant's menu (step 46): reading it, owners adding, changing,
// moving and deleting dishes (one typed in, or a whole menu reading after
// "Looks right"), and anyone in the company marking a dish "Not available
// today". Prices are typed as text and stored in cents of the restaurant's
// currency, so a menu needs a currency first (setup's orders step).

export type MenuView = {
  items: MenuItemRow[];
  // null until setup's orders step chose one: nothing can be priced yet.
  currency: string | null;
  canEdit: boolean;
};

const ownersOnly: FormResult = { ok: false, errors: { message: "Only owners can change the menu." } };
const tooManyChanges: FormResult = { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };
const noCurrency: FormResult = { ok: false, errors: { message: "Choose your currency in What it knows first: every price is in it." } };

// The session company's menu, its currency, and whether this person edits it.
export async function getMenuForSession(session: SessionContext): Promise<MenuView> {
  const [items, settings] = await Promise.all([listMenuItems(session.companyId), getAssistantSettings(session.companyId)]);
  return { items, currency: settings?.currency ?? null, canEdit: canEditMenu(session.role) };
}

// Adds one dish typed on the menu page. Owners only.
export async function addMenuItemForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const refusal = await refuseEditUnlessAllowed(session);
  if (refusal) {
    return refusal;
  }
  const parsed = menuItemFieldsSchema.safeParse(input);
  if (!parsed.success) {
    return fieldErrors(parsed.error);
  }
  const currency = await currencyOf(session);
  if (!currency) {
    return noCurrency;
  }
  const item = withPrice(parsed.data, currency);
  if (!item) {
    return { ok: false, errors: { fieldErrors: { price: ["Write a price like 9.50."] } } };
  }
  return describeOutcome(await addMenuItems(session.companyId, session.userId, [item]));
}

// "Looks right": adds every dish of a menu reading as the owner left them,
// each checked again (the list came back from the browser). All or none.
// Owners only.
export async function addCheckedMenuReadingForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const refusal = await refuseEditUnlessAllowed(session);
  if (refusal) {
    return refusal;
  }
  const parsed = confirmMenuReadingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: describeRowProblem(parsed.error) } };
  }
  const currency = await currencyOf(session);
  if (!currency) {
    return noCurrency;
  }
  const items: MenuItemFields[] = [];
  for (const [index, row] of parsed.data.items.entries()) {
    const item = withPrice(row, currency);
    if (!item) {
      return { ok: false, errors: { message: `Dish ${index + 1} (${row.name}): write its price like 9.50.` } };
    }
    items.push(item);
  }
  return describeOutcome(await addMenuItems(session.companyId, session.userId, items));
}

// Changes one dish's category, name, description and price. Owners only.
export async function updateMenuItemForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const refusal = await refuseEditUnlessAllowed(session);
  if (refusal) {
    return refusal;
  }
  const parsed = editMenuItemSchema.safeParse(input);
  if (!parsed.success) {
    return fieldErrors(parsed.error);
  }
  const currency = await currencyOf(session);
  if (!currency) {
    return noCurrency;
  }
  const item = withPrice(parsed.data, currency);
  if (!item) {
    return { ok: false, errors: { fieldErrors: { price: ["Write a price like 9.50."] } } };
  }
  return describeOutcome(await updateMenuItem(session.companyId, session.userId, parsed.data.itemId, item));
}

// Takes one dish off the menu. Owners only.
export async function deleteMenuItemForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const refusal = await refuseEditUnlessAllowed(session);
  if (refusal) {
    return refusal;
  }
  const parsed = menuItemIdInputSchema.safeParse(input);
  return parsed.success ? describeOutcome(await deleteMenuItem(session.companyId, session.userId, parsed.data.itemId)) : notFound();
}

// Moves one dish up or down within its category. Owners only.
export async function moveMenuItemForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const refusal = await refuseEditUnlessAllowed(session);
  if (refusal) {
    return refusal;
  }
  const parsed = moveMenuItemSchema.safeParse(input);
  return parsed.success ? describeOutcome(await moveMenuItem(session.companyId, session.userId, parsed.data.itemId, parsed.data.direction)) : notFound();
}

// "Not available today" (until the restaurant's midnight, in its own time
// zone; UTC before setup chose one), or available again. Anyone in the company.
export async function setMenuItemAvailabilityForSession(session: SessionContext, input: unknown, now = new Date()): Promise<FormResult> {
  if (!canMarkMenuAvailability(session.role)) {
    return ownersOnly;
  }
  if (await isOverRateLimit("menu-changes", session.userId, RATE_LIMITS.menuChangesPerUser)) {
    return tooManyChanges;
  }
  const parsed = menuAvailabilitySchema.safeParse(input);
  if (!parsed.success) {
    return notFound();
  }
  const timeZone = (await getAssistantSettings(session.companyId))?.timeZone ?? "UTC";
  const unavailableUntil = parsed.data.available ? null : endOfLocalDay(timeZone, now);
  return describeOutcome(await setMenuItemAvailability(session.companyId, session.userId, parsed.data.itemId, unavailableUntil));
}

// Owners only, and within the menu-changes limit. Null when the change may go ahead.
async function refuseEditUnlessAllowed(session: SessionContext): Promise<FormResult | null> {
  if (!canEditMenu(session.role)) {
    return ownersOnly;
  }
  if (await isOverRateLimit("menu-changes", session.userId, RATE_LIMITS.menuChangesPerUser)) {
    return tooManyChanges;
  }
  return null;
}

async function currencyOf(session: SessionContext): Promise<string | null> {
  return (await getAssistantSettings(session.companyId))?.currency ?? null;
}

// The dish with its price in cents, or null when the price can't be read.
function withPrice(row: { category: string; name: string; description: string; price: string }, currency: string): MenuItemFields | null {
  const priceCents = parsePrice(row.price, currency);
  return priceCents === null ? null : { category: row.category, name: row.name, description: row.description, priceCents };
}

function describeOutcome(outcome: MenuWriteOutcome): FormResult {
  if (outcome === "saved") {
    return { ok: true };
  }
  if (outcome === "too-many") {
    return { ok: false, errors: { message: `A menu holds at most ${MENU_ITEMS_MAX} dishes. Delete some first.` } };
  }
  return outcome === "not-found" ? notFound() : ownersOnly;
}

function notFound(): FormResult {
  return { ok: false, errors: { message: "This dish is no longer on the menu. Reload the page." } };
}

function fieldErrors(error: z.ZodError): FormResult {
  return { ok: false, errors: { fieldErrors: z.flattenError(error).fieldErrors } };
}

// The first problem of a checked reading, naming its row ("Dish 3: ...").
function describeRowProblem(error: z.ZodError): string {
  const issue = error.issues[0];
  const row = typeof issue?.path[1] === "number" ? `Dish ${issue.path[1] + 1}: ` : "";
  return `${row}${issue?.message ?? "Check the list and try again."}`;
}
