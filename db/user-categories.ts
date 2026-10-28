import "server-only";
import { and, eq, inArray, isNull, sql, TransactionRollbackError } from "drizzle-orm";
import { db, type DbTransaction } from "./client";
import { lockCompanyRow } from "./company-lock";
import { routeUnassignedTicketsInCategories, type RoutedTicket } from "./routing";
import { categories, userCategories, users } from "./schema";
import { canTakeTickets } from "./users";

// Who handles which category in one company (routing picks experts from
// these links, db/routing.ts). The categories themselves are in db/categories.ts.

export type UserCategoryLink = {
  userId: string;
  categoryId: string;
};

export type CategoriesSaved =
  | { saved: false }
  // routedTickets: tickets that waited in these categories and were routed.
  | { saved: true; routedTickets: RoutedTicket[] };

// Lists who handles which category in one company.
export async function getUserCategoryLinks(companyId: string): Promise<UserCategoryLink[]> {
  return db
    .select({ userId: userCategories.userId, categoryId: userCategories.categoryId })
    .from(userCategories)
    .where(eq(userCategories.companyId, companyId));
}

// Replaces the ACTIVE categories one person handles. The person must be able
// to take tickets (confirmed, not removed) and every category must be an
// active one of this company. The categories are checked inside the statement
// that links them, and the person there too, plus by a lock on their row held
// until the end: never by a plain earlier read that could go stale (CLAUDE.md).
// The foreign keys check the company again. Returns saved: false, changing
// nothing, otherwise.
// Links to archived categories are kept: the Team page never shows them, and
// restoring a category must bring its experts back with it.
// Open tickets that waited, unassigned, in these categories are routed in the
// same transaction (step 29); whoever gets one is returned, to be emailed
// after commit.
export async function replaceUserCategories(
  companyId: string,
  userId: string,
  categoryIds: string[],
): Promise<CategoriesSaved> {
  const wantedIds = [...new Set(categoryIds)];
  try {
    return await db.transaction(async (tx) => {
      // First, before the person is locked: tickets are routed below, and
      // routing must not run at the same time as another routing in this
      // company (db/routing.ts).
      await lockCompanyRow(tx, companyId);
      if (!(await lockPersonWhoCanTakeTickets(tx, companyId, userId))) {
        tx.rollback();
      }
      await tx
        .delete(userCategories)
        .where(
          and(
            eq(userCategories.companyId, companyId),
            eq(userCategories.userId, userId),
            inArray(userCategories.categoryId, activeCategoryIds(tx, companyId)),
          ),
        );
      if (wantedIds.length === 0) {
        return { saved: true, routedTickets: [] };
      }
      const linkedCount = await linkActiveCategories(tx, companyId, userId, wantedIds);
      if (linkedCount !== wantedIds.length) {
        // A category is unknown, archived or another company's: undo the delete too.
        tx.rollback();
      }
      return { saved: true, routedTickets: await routeUnassignedTicketsInCategories(tx, companyId, wantedIds) };
    });
  } catch (error) {
    if (error instanceof TransactionRollbackError) {
      return { saved: false };
    }
    throw error;
  }
}

// Locks the person's row until the transaction ends, if they are in this
// company and can take tickets. WHY "no key update": a removal being saved at
// this moment is waited for and then seen, and two saves of this person's
// categories run one after the other instead of tripping over each other's
// links. Foreign keys pointing at the person (a ticket being assigned to them)
// are not held up by it.
async function lockPersonWhoCanTakeTickets(tx: DbTransaction, companyId: string, userId: string): Promise<boolean> {
  const [person] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.companyId, companyId), canTakeTickets))
    .for("no key update");
  return person !== undefined;
}

// Links the person to the wanted categories in ONE statement that checks each
// of them as it goes: only active categories of this company, and only while
// the person can take tickets there. Returns how many it linked. The
// categories are locked too, so archiving one at this very moment either waits
// for this transaction or is seen by it.
async function linkActiveCategories(tx: DbTransaction, companyId: string, userId: string, categoryIds: string[]): Promise<number> {
  const linked = await tx
    .insert(userCategories)
    .select(
      tx
        .select({
          companyId: users.companyId,
          userId: users.id,
          categoryId: categories.id,
          createdAt: sql<Date>`now()`.as("created_at"),
        })
        .from(users)
        .innerJoin(categories, eq(categories.companyId, users.companyId))
        .where(
          and(
            eq(users.id, userId),
            eq(users.companyId, companyId),
            canTakeTickets,
            inArray(categories.id, categoryIds),
            isNull(categories.archivedAt),
          ),
        )
        .for("share", { of: categories }),
    )
    .onConflictDoNothing()
    .returning({ categoryId: userCategories.categoryId });
  return linked.length;
}

function activeCategoryIds(tx: DbTransaction, companyId: string) {
  return tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.companyId, companyId), isNull(categories.archivedAt)));
}
