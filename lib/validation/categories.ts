import { z } from "zod";
import { ACTIVE_CATEGORIES_MAX, CATEGORY_NAME_MAX_LENGTH } from "@/lib/form-limits";
import { formUserIdSchema, NO_CONTROL_CHARACTERS, NO_LINE_BREAKS_OR_CONTROL_CHARACTERS } from "./control-characters";

// Category names are shown to experts and sent to Claude, one per line, so
// keep them short and plain: no angle brackets (they could break out of the
// prompt's tags) and no line breaks (a name would become extra lines).
export const categoryNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a category name")
  .max(CATEGORY_NAME_MAX_LENGTH, `Category names can be at most ${CATEGORY_NAME_MAX_LENGTH} characters`)
  .regex(/^[^<>]+$/, "Category names can't contain < or >")
  .regex(NO_LINE_BREAKS_OR_CONTROL_CHARACTERS, "Category names can't contain line breaks or other control characters");

export const createCategorySchema = z.object({
  name: categoryNameSchema,
});

export const renameCategorySchema = z.object({
  categoryId: z.uuid(),
  name: categoryNameSchema,
});

export const archiveCategorySchema = z.object({
  categoryId: z.uuid(),
  archived: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const setUserCategoriesSchema = z.object({
  userId: formUserIdSchema,
  // Each one is only a claim: the database checks it is an active category of
  // the same company before saving. A company has at most this many.
  categoryIds: z.array(z.uuid()).max(ACTIVE_CATEGORIES_MAX),
});

export const setTicketCategorySchema = z.object({
  ticketId: z.uuid(),
  // "" is the "No category" choice in the form and becomes null.
  category: z
    .string()
    .trim()
    .max(50)
    .regex(NO_CONTROL_CHARACTERS)
    .transform((value) => (value === "" ? null : value)),
});
