import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { DbTransaction } from "./client";
import { users, type UserRole } from "./schema";

// Who is writing one company's knowledge (step 34), business profile and
// interview (step 36) or marketing plans and their setting (step 37), read
// again inside the transaction that writes (db/knowledge-writes.ts,
// db/knowledge-status.ts, db/business-facts.ts, db/business-fact-proposals.ts,
// db/onboarding-messages.ts, db/marketing-plans.ts, db/cofounder-settings.ts).
//
// WHY the person's role is read again here, locked: the session's role was
// read when the request began, and an owner made a member (or removed) at
// that moment must not still approve or change what the AI uses. FOR SHARE
// waits for a role change being saved on their row, then reads it.

// The person's role in this company, read with their row locked FOR SHARE
// until the transaction ends, or null when they are no longer an active,
// confirmed member of it.
export async function lockActiveAuthorRole(tx: DbTransaction, companyId: string, userId: string): Promise<UserRole | null> {
  const [person] = await tx
    .select({ role: users.role })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.companyId, companyId), eq(users.emailVerified, true), isNull(users.deactivatedAt)))
    .for("share");
  return person?.role ?? null;
}
