import "server-only";
import { and, asc, count, eq, isNull, ne, sql } from "drizzle-orm";
import { ACTIVE_CATEGORIES_MAX } from "@/lib/form-limits";
import { db, type DbTransaction } from "./client";
import { lockCompanyRow } from "./company-lock";
import { isUniqueViolation } from "./errors";
import { routeUnassignedTicketsInCategories, type RoutedTicket } from "./routing";
import { categories } from "./schema";

// One company's categories. Who handles which one is in db/user-categories.ts.

export type Category = {
  id: string;
  name: string;
  archived: boolean;
};

export type CategoryCreation = "created" | "name-taken" | "limit-reached";

export type CategoryArchiving = {
  updated: boolean;
  // A restore was refused: the company already has ACTIVE_CATEGORIES_MAX
  // active categories.
  limitReached: boolean;
  // Tickets that waited in a restored category and were routed (step 29).
  routedTickets: RoutedTicket[];
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

// One company's active categories by name, with their ids. The call brain and
// email triage offer the names to Claude, then save the ticket by id, so a
// rename while Claude thinks is followed (db/ticket-creation.ts).
export async function getActiveCategories(companyId: string): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(and(eq(categories.companyId, companyId), isNull(categories.archivedAt)))
    .orderBy(asc(categories.name));
}

// Names of one company's active categories, for ticket menus.
export async function getActiveCategoryNames(companyId: string): Promise<string[]> {
  return (await getActiveCategories(companyId)).map((category) => category.name);
}

// Adds a category to one company, unless the name (in any letter case)
// already exists there, or the company already has ACTIVE_CATEGORIES_MAX
// active ones.
export async function createCategory(companyId: string, name: string): Promise<CategoryCreation> {
  return db.transaction(async (tx) => {
    // Two creations at the same moment count one after the other.
    await lockCompanyRow(tx, companyId);
    if ((await countOtherActiveCategories(tx, companyId, null)) >= ACTIVE_CATEGORIES_MAX) {
      return "limit-reached";
    }
    const inserted = await tx
      .insert(categories)
      .values({ companyId, name })
      .onConflictDoNothing()
      .returning({ id: categories.id });
    return inserted.length > 0 ? "created" : "name-taken";
  });
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

// Archives (or restores) one company's category. Restoring it routes the
// company's open unassigned tickets in it, in the same transaction (step 29);
// whoever gets one is returned, to be emailed after commit.
export async function setCategoryArchived(companyId: string, categoryId: string, archived: boolean): Promise<CategoryArchiving> {
  return db.transaction(async (tx) => {
    // First: a restore routes tickets below, and routing must not run at the
    // same time as another routing in this company (db/routing.ts). It also
    // makes the count below and a creation at the same moment take turns.
    await lockCompanyRow(tx, companyId);
    if (!archived && (await countOtherActiveCategories(tx, companyId, categoryId)) >= ACTIVE_CATEGORIES_MAX) {
      return { updated: false, limitReached: true, routedTickets: [] };
    }
    const updated = await tx
      .update(categories)
      .set({ archivedAt: archived ? sql`now()` : null })
      .where(and(eq(categories.id, categoryId), eq(categories.companyId, companyId)))
      .returning({ id: categories.id });
    if (updated.length === 0) {
      return { updated: false, limitReached: false, routedTickets: [] };
    }
    const routedTickets = archived ? [] : await routeUnassignedTicketsInCategories(tx, companyId, [categoryId]);
    return { updated: true, limitReached: false, routedTickets };
  });
}

// How many active categories one company has, leaving out exceptCategoryId
// (the one being restored, which may be active already).
async function countOtherActiveCategories(tx: DbTransaction, companyId: string, exceptCategoryId: string | null): Promise<number> {
  const conditions = [eq(categories.companyId, companyId), isNull(categories.archivedAt)];
  if (exceptCategoryId !== null) {
    conditions.push(ne(categories.id, exceptCategoryId));
  }
  const [row] = await tx.select({ total: count() }).from(categories).where(and(...conditions));
  return row?.total ?? 0;
}
