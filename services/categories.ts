import "server-only";
import { z } from "zod";
import {
  createCategory,
  getActiveCategoryNames,
  getCategoriesForCompany,
  getUserCategoryLinks,
  renameCategory,
  replaceUserCategories,
  setCategoryArchived,
  type Category,
  type UserCategoryLink,
} from "@/db/categories";
import { setTicketCategory } from "@/db/ticket-updates";
import type { FormResult } from "@/lib/form-result";
import type { SessionContext } from "@/lib/session";
import {
  archiveCategorySchema,
  createCategorySchema,
  renameCategorySchema,
  setTicketCategorySchema,
  setUserCategoriesSchema,
} from "@/lib/validation/categories";
import { notifyAssignee } from "./assignment-notifications";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// Re-exported so pages can use the types without importing from /db.
export type { Category, UserCategoryLink };

export type TeamCategories = {
  categories: Category[];
  links: UserCategoryLink[];
};

const ownersOnly: FormResult = { ok: false, errors: { message: "Only owners can manage categories." } };
const tooManyChanges: FormResult = { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };

// Lists the session company's categories and who handles which, for the Team page.
export async function getTeamCategoriesForSession(session: SessionContext): Promise<TeamCategories> {
  const [categories, links] = await Promise.all([
    getCategoriesForCompany(session.companyId),
    getUserCategoryLinks(session.companyId),
  ]);
  return { categories, links };
}

// Names of the session company's active categories, for the ticket page menu.
export async function listActiveCategoryNamesForSession(session: SessionContext): Promise<string[]> {
  return getActiveCategoryNames(session.companyId);
}

// Adds a category to the session's company. Owners only.
export async function createCategoryForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  if (session.role !== "owner") {
    return ownersOnly;
  }
  const parsed = createCategorySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  if (await isOverSettingsLimit(session)) {
    return tooManyChanges;
  }
  const created = await createCategory(session.companyId, parsed.data.name);
  return created ? { ok: true } : { ok: false, errors: { fieldErrors: { name: ["That category already exists."] } } };
}

// Renames one of the session company's categories; its tickets follow. Owners only.
export async function renameCategoryForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  if (session.role !== "owner") {
    return ownersOnly;
  }
  const parsed = renameCategorySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  if (await isOverSettingsLimit(session)) {
    return tooManyChanges;
  }
  const renamed = await renameCategory(session.companyId, parsed.data.categoryId, parsed.data.name);
  return renamed ? { ok: true } : { ok: false, errors: { message: "That name is taken, or the category was not found." } };
}

// Archives or restores one of the session company's categories. Owners only.
export async function setCategoryArchivedForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  if (session.role !== "owner") {
    return ownersOnly;
  }
  const parsed = archiveCategorySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "Unknown category." } };
  }
  if (await isOverSettingsLimit(session)) {
    return tooManyChanges;
  }
  const updated = await setCategoryArchived(session.companyId, parsed.data.categoryId, parsed.data.archived);
  return updated ? { ok: true } : { ok: false, errors: { message: "Category not found." } };
}

// Sets which categories one person handles. Anyone may set their own;
// owners may set anyone's in their company.
export async function setUserCategoriesForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = setUserCategoriesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "Unknown person or category." } };
  }
  const { userId, categoryIds } = parsed.data;
  if (userId !== session.userId && session.role !== "owner") {
    return { ok: false, errors: { message: "You can only change your own categories." } };
  }
  if (await isOverSettingsLimit(session)) {
    return tooManyChanges;
  }
  const replaced = await replaceUserCategories(session.companyId, userId, categoryIds);
  return replaced ? { ok: true } : { ok: false, errors: { message: "Unknown person or category." } };
}

// Sets or clears the category of one of the session company's tickets. An
// unassigned ticket is then routed to an expert. Anyone in the company may do this.
export async function setTicketCategoryForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = setTicketCategorySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "Unknown ticket or category." } };
  }
  if (await isOverRateLimit("ticket-changes", session.userId, RATE_LIMITS.ticketChangesPerUser)) {
    return tooManyChanges;
  }
  const { updated, routedTo } = await setTicketCategory(session.companyId, parsed.data.ticketId, parsed.data.category);
  if (!updated) {
    return { ok: false, errors: { message: "That ticket or category was not found in your company." } };
  }
  // Setting the category routed it: tell the expert (step 13).
  if (routedTo) {
    await notifyAssignee({ companyId: session.companyId, ticketId: parsed.data.ticketId, assigneeUserId: routedTo, assignedByUserId: null });
  }
  return { ok: true };
}

function isOverSettingsLimit(session: SessionContext): Promise<boolean> {
  return isOverRateLimit("settings-changes", session.userId, RATE_LIMITS.settingsChangesPerUser);
}
