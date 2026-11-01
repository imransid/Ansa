import { z } from "zod";
import {
  MENU_CATEGORY_MAX_LENGTH,
  MENU_DESCRIPTION_MAX_LENGTH,
  MENU_ITEMS_PER_READING_MAX,
  MENU_NAME_MAX_LENGTH,
  MENU_PRICE_TEXT_MAX_LENGTH,
  MENU_TEXT_MAX_LENGTH,
} from "@/lib/menu";
import { toPlainSingleLine } from "@/lib/plain-text";
import { multilineText } from "./ticket-fields";

// The menu's forms (step 46). A price is checked as text here and turned into
// cents by the service, in the restaurant's own currency (lib/menu.ts).

function plainLine(min: number, max: number, emptyMessage: string) {
  return z
    .string()
    .transform(toPlainSingleLine)
    .pipe(z.string().min(min, emptyMessage).max(max, `At most ${max} characters.`));
}

// One dish as typed: in the add and edit forms, and each row of a menu
// reading the owner checked.
export const menuItemFieldsSchema = z.object({
  category: plainLine(0, MENU_CATEGORY_MAX_LENGTH, ""),
  name: plainLine(1, MENU_NAME_MAX_LENGTH, "Give the dish a name."),
  description: plainLine(0, MENU_DESCRIPTION_MAX_LENGTH, ""),
  price: z.string().trim().min(1, "Give the dish a price.").max(MENU_PRICE_TEXT_MAX_LENGTH, "Write a price like 9.50."),
});

// An id from a form is only a claim; lowercased, as Postgres gives it back.
const menuItemIdSchema = z.uuid().transform((id) => id.toLowerCase());

export const editMenuItemSchema = menuItemFieldsSchema.extend({ itemId: menuItemIdSchema });

export const menuItemIdInputSchema = z.object({ itemId: menuItemIdSchema });

export const menuAvailabilitySchema = z.object({
  itemId: menuItemIdSchema,
  available: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const moveMenuItemSchema = z.object({ itemId: menuItemIdSchema, direction: z.enum(["up", "down"]) });

// "Looks right": the dishes of a reading, as the owner left them.
export const confirmMenuReadingSchema = z.object({
  items: z
    .array(menuItemFieldsSchema)
    .min(1, "There are no dishes to add.")
    .max(MENU_ITEMS_PER_READING_MAX, `At most ${MENU_ITEMS_PER_READING_MAX} dishes at a time.`),
});

// A pasted menu: several lines, as typed.
export const pastedMenuSchema = multilineText().pipe(
  z
    .string()
    .trim()
    .max(MENU_TEXT_MAX_LENGTH, `Paste at most ${MENU_TEXT_MAX_LENGTH.toLocaleString("en-US")} characters at a time.`)
    .regex(/^(?:[^\p{Cc}]|[\n\t])*$/u, "Remove the invisible control characters from the text."),
);
