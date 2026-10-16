import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./client";
import { isUniqueViolation } from "./errors";
import { categories, userCategories, users } from "./schema";

export type Category = {
  id: string;
  name: string;
  archived: boolean;
};

export type UserCategoryLink = {
  userId: string;
  categoryId: string;
};

// Lists one company's categories, active ones first, then by name.
export async function getCategoriesForCompany(companyId: string): Promise<Category[]> {
  const rows = await db
    .select({ id: categories.id, name: categories.name, archivedAt: categories.archivedAt })
    .from(categories)
    .where(eq(categories.companyId, companyId))
    .orderBy(sql`${categories.archivedAt} IS NOT NULL`, asc(categories.name));
  return rows.map((row) => ({ id: row.id, name: row.name, archived: row.archivedAt !== null }));
}

// Names of one company's active categories, for the call brain and ticket menus.
export async function getActiveCategoryNames(companyId: string): Promise<string[]> {
  const rows = await db
    .select({ name: categories.name })
    .from(categories)
    .where(and(eq(categories.companyId, companyId), isNull(categories.archivedAt)))
    .orderBy(asc(categories.name));
  return rows.map((row) => row.name);
}

// Adds a category to one company. Returns false if the name (in any letter
// case) already exists there.
export async function createCategory(companyId: string, name: string): Promise<boolean> {
  const inserted = await db
    .insert(categories)
    .values({ companyId, name })
    .onConflictDoNothing()
    .returning({ id: categories.id });
  return inserted.length > 0;
}

// Renames one company's category. Tickets follow automatically (ON UPDATE
// CASCADE). Returns false if not found, or the new name is taken.
export async function renameCategory(companyId: string, categoryId: string, name: string): Promise<boolean> {
  const taken = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.companyId, companyId), sql`lower(${categories.name}) = lower(${name})`));
  if (taken.some((row) => row.id !== categoryId)) {
    return false;
  }
  try {
    const renamed = await db
      .update(categories)
      .set({ name })
      .where(and(eq(categories.id, categoryId), eq(categories.companyId, companyId)))
      .returning({ id: categories.id });
    return renamed.length > 0;
  } catch (error) {
    // Someone took the name between the check above and this update.
    if (isUniqueViolation(error)) {
      return false;
    }
    throw error;
  }
}

// Archives (or restores) one company's category.
export async function setCategoryArchived(companyId: string, categoryId: string, archived: boolean): Promise<boolean> {
  const updated = await db
    .update(categories)
    .set({ archivedAt: archived ? sql`now()` : null })
    .where(and(eq(categories.id, categoryId), eq(categories.companyId, companyId)))
    .returning({ id: categories.id });
  return updated.length > 0;
}

// Lists who handles which category in one company.
export async function getUserCategoryLinks(companyId: string): Promise<UserCategoryLink[]> {
  return db
    .select({ userId: userCategories.userId, categoryId: userCategories.categoryId })
    .from(userCategories)
    .where(eq(userCategories.companyId, companyId));
}

// Replaces the categories one person handles. The user and every category
// must belong to this company (checked here, and by the foreign keys), and
// the categories must be active. Returns false, changing nothing, otherwise.
export async function replaceUserCategories(
  companyId: string,
  userId: string,
  categoryIds: string[],
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const person = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.companyId, companyId)));
    if (person.length === 0) {
      return false;
    }
    if (categoryIds.length > 0) {
      const usable = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.companyId, companyId), isNull(categories.archivedAt), inArray(categories.id, categoryIds)));
      if (usable.length !== new Set(categoryIds).size) {
        return false;
      }
    }
    await tx
      .delete(userCategories)
      .where(and(eq(userCategories.companyId, companyId), eq(userCategories.userId, userId)));
    if (categoryIds.length > 0) {
      await tx
        .insert(userCategories)
        .values([...new Set(categoryIds)].map((categoryId) => ({ companyId, userId, categoryId })));
    }
    return true;
  });
}
