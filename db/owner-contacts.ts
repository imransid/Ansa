import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./client";
import { users } from "./schema";

// Who an owner alert goes to (step 49): the company's owners who confirmed
// their address and weren't removed. Never a member, never another company's.
export async function listOwnersToAlert(companyId: string): Promise<{ id: string; name: string; email: string }[]> {
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.role, "owner"), eq(users.emailVerified, true), isNull(users.deactivatedAt)));
}
