import "server-only";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { MENU_ITEMS_MAX } from "@/lib/menu";
import { canEditMenu, canMarkMenuAvailability } from "@/lib/restaurant-permissions";
import { db, type DbTransaction } from "./client";
import { lockCompanyRow } from "./company-lock";
import { lockActiveAuthorRole } from "./knowledge-author";
import { catalogItems } from "./schema";

// One restaurant's menu (step 46). Every write checks the person again inside
// its transaction (their role read FOR SHARE, db/knowledge-author.ts says
// why), after the company row lock when it adds dishes (the MENU_ITEMS_MAX
// count) or moves one (positions), and names its columns. An id from a form
// is only a claim: every write matches it with the session's company.

export type MenuItemRow = {
  id: string;
  category: string;
  name: string;
  description: string;
  priceCents: number;
  available: boolean;
};

// The fields a person types for one dish (price already in cents).
export type MenuItemFields = { category: string; name: string; description: string; priceCents: number };

export type MenuWriteOutcome = "saved" | "not-allowed" | "not-found" | "too-many";

// The company's dishes in menu order.
export async function listMenuItems(companyId: string): Promise<MenuItemRow[]> {
  return db
    .select({
      id: catalogItems.id,
      category: catalogItems.category,
      name: catalogItems.name,
      description: catalogItems.description,
      priceCents: catalogItems.priceCents,
      // "Not available today" ends by itself at the restaurant's midnight.
      available: sql<boolean>`(${catalogItems.unavailableUntil} IS NULL OR ${catalogItems.unavailableUntil} <= now())`,
    })
    .from(catalogItems)
    .where(eq(catalogItems.companyId, companyId))
    .orderBy(asc(catalogItems.position), asc(catalogItems.createdAt));
}

// How many dishes the company's menu holds (Home's getting-started list).
export async function countMenuItems(companyId: string): Promise<number> {
  const [row] = await db.select({ total: count() }).from(catalogItems).where(eq(catalogItems.companyId, companyId));
  return row?.total ?? 0;
}

// Adds dishes at the end of the menu, in the order given: one typed in, or
// every dish of a menu reading the owner said "Looks right" to. All or none.
export async function addMenuItems(companyId: string, actorUserId: string, items: MenuItemFields[]): Promise<MenuWriteOutcome> {
  return db.transaction(async (tx) => {
    await lockCompanyRow(tx, companyId);
    if (!(await isEditor(tx, companyId, actorUserId))) {
      return "not-allowed";
    }
    const [existing] = await tx.select({ total: count() }).from(catalogItems).where(eq(catalogItems.companyId, companyId));
    if ((existing?.total ?? 0) + items.length > MENU_ITEMS_MAX) {
      return "too-many";
    }
    const [last] = await tx
      .select({ position: catalogItems.position })
      .from(catalogItems)
      .where(eq(catalogItems.companyId, companyId))
      .orderBy(desc(catalogItems.position))
      .limit(1);
    const start = (last?.position ?? 0) + 1;
    await tx.insert(catalogItems).values(
      items.map((item, index) => ({
        companyId,
        category: item.category,
        name: item.name,
        description: item.description,
        priceCents: item.priceCents,
        position: start + index,
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId,
      })),
    );
    return "saved";
  });
}

// Changes one dish's category, name, description and price.
export async function updateMenuItem(companyId: string, actorUserId: string, itemId: string, fields: MenuItemFields): Promise<MenuWriteOutcome> {
  return db.transaction(async (tx) => {
    if (!(await isEditor(tx, companyId, actorUserId))) {
      return "not-allowed";
    }
    const updated = await tx
      .update(catalogItems)
      .set({
        category: fields.category,
        name: fields.name,
        description: fields.description,
        priceCents: fields.priceCents,
        updatedByUserId: actorUserId,
        updatedAt: sql`now()`,
      })
      .where(and(eq(catalogItems.id, itemId), eq(catalogItems.companyId, companyId)))
      .returning({ id: catalogItems.id });
    return updated.length > 0 ? "saved" : "not-found";
  });
}

// Takes one dish off the menu for good.
export async function deleteMenuItem(companyId: string, actorUserId: string, itemId: string): Promise<MenuWriteOutcome> {
  return db.transaction(async (tx) => {
    if (!(await isEditor(tx, companyId, actorUserId))) {
      return "not-allowed";
    }
    const deleted = await tx
      .delete(catalogItems)
      .where(and(eq(catalogItems.id, itemId), eq(catalogItems.companyId, companyId)))
      .returning({ id: catalogItems.id });
    return deleted.length > 0 ? "saved" : "not-found";
  });
}

// "Not available today" until `unavailableUntil` (the end of the
// restaurant's day), or available again (null). Anyone in the company.
export async function setMenuItemAvailability(
  companyId: string,
  actorUserId: string,
  itemId: string,
  unavailableUntil: Date | null,
): Promise<MenuWriteOutcome> {
  return db.transaction(async (tx) => {
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    if (!role || !canMarkMenuAvailability(role)) {
      return "not-allowed";
    }
    const updated = await tx
      .update(catalogItems)
      .set({ unavailableUntil, updatedByUserId: actorUserId, updatedAt: sql`now()` })
      .where(and(eq(catalogItems.id, itemId), eq(catalogItems.companyId, companyId)))
      .returning({ id: catalogItems.id });
    return updated.length > 0 ? "saved" : "not-found";
  });
}

// Swaps one dish with the dish before or after it in the same category, so
// it moves up or down where the menu page shows it. Nothing to swap with
// (already first or last) changes nothing.
export async function moveMenuItem(companyId: string, actorUserId: string, itemId: string, direction: "up" | "down"): Promise<MenuWriteOutcome> {
  return db.transaction(async (tx) => {
    await lockCompanyRow(tx, companyId);
    if (!(await isEditor(tx, companyId, actorUserId))) {
      return "not-allowed";
    }
    const [item] = await tx
      .select({ category: catalogItems.category, position: catalogItems.position })
      .from(catalogItems)
      .where(and(eq(catalogItems.id, itemId), eq(catalogItems.companyId, companyId)));
    if (!item) {
      return "not-found";
    }
    const neighbourCondition =
      direction === "up" ? sql`${catalogItems.position} < ${item.position}` : sql`${catalogItems.position} > ${item.position}`;
    const [neighbour] = await tx
      .select({ id: catalogItems.id, position: catalogItems.position })
      .from(catalogItems)
      .where(and(eq(catalogItems.companyId, companyId), eq(catalogItems.category, item.category), neighbourCondition))
      .orderBy(direction === "up" ? desc(catalogItems.position) : asc(catalogItems.position))
      .limit(1);
    if (neighbour) {
      await setPosition(tx, companyId, itemId, neighbour.position);
      await setPosition(tx, companyId, neighbour.id, item.position);
    }
    return "saved";
  });
}

async function setPosition(tx: DbTransaction, companyId: string, itemId: string, position: number): Promise<void> {
  await tx
    .update(catalogItems)
    .set({ position })
    .where(and(eq(catalogItems.id, itemId), eq(catalogItems.companyId, companyId)));
}

// Whether the person is still an owner of the company, read again with their
// row locked.
async function isEditor(tx: DbTransaction, companyId: string, actorUserId: string): Promise<boolean> {
  const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
  return role !== null && canEditMenu(role);
}
