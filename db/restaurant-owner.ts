import "server-only";
import { eq, sql } from "drizzle-orm";
import { canManageRestaurant } from "@/lib/restaurant-permissions";
import { db, type DbTransaction } from "./client";
import { lockCompanyRow } from "./company-lock";
import { lockActiveAuthorRole } from "./knowledge-author";
import { companies } from "./schema";

// "not-allowed": the person is no longer an active owner of the company
// (made a member or removed since the request began): nothing was written.
export type SetupWriteOutcome = "saved" | "not-allowed";

// Runs one owner's change of the restaurant's setup or assistant (step 45) in
// one transaction. The company row lock comes FIRST (db/company-lock.ts:
// these writes update that row, and every transaction that takes it takes
// it before any person), then the person's role is read again, locked
// (db/knowledge-author.ts says why).
export async function asRestaurantOwner(
  companyId: string,
  actorUserId: string,
  work: (tx: DbTransaction) => Promise<void>,
): Promise<SetupWriteOutcome> {
  return db.transaction(async (tx) => {
    await lockCompanyRow(tx, companyId);
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    if (!role || !canManageRestaurant(role)) {
      return "not-allowed";
    }
    await work(tx);
    return "saved";
  });
}

// Moves the company's setup progress up to `reached` saved steps, never down
// (an owner going back to step 2 keeps steps 3 to 5 done). null: the change
// came from Settings, not from setup.
export async function recordSetupProgressWithin(tx: DbTransaction, companyId: string, reached: number | null): Promise<void> {
  if (reached === null) {
    return;
  }
  await tx
    .update(companies)
    .set({ setupProgress: sql`GREATEST(${companies.setupProgress}, ${reached})` })
    .where(eq(companies.id, companyId));
}
