import { z } from "zod";

// Category names are shown to experts and sent to Claude, so keep them short
// and plain: no angle brackets (they could break out of the prompt's tags).
export const categoryNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a category name")
  .max(50, "Category names can be at most 50 characters")
  .regex(/^[^<>]+$/, "Category names can't contain < or >");

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
  userId: z.string().min(1).max(100),
  // Each one is only a claim: the database checks it is an active category of
  // the same company before saving.
  categoryIds: z.array(z.uuid()).max(50),
});

export const setTicketCategorySchema = z.object({
  ticketId: z.uuid(),
  // "" is the "No category" choice in the form and becomes null.
  category: z
    .string()
    .trim()
    .max(50)
    .transform((value) => (value === "" ? null : value)),
});
