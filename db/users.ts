import "server-only";
import { and, asc, count, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./client";
import { sessions, users, verifications, type UserRole } from "./schema";

export type CompanyUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  // false until they open the link in their confirmation email (step 12).
  emailConfirmed: boolean;
  // When an owner removed them from the team, or null (db/team-members.ts).
  removedAt: Date | null;
};

export type AssignableUser = {
  id: string;
  name: string;
  // Shown next to names two teammates share, so the menu tells them apart.
  email: string;
};

// Who can be given tickets, by routing or by a person: only people who
// confirmed their email and were not removed. Someone unconfirmed can't log
// in yet and may have joined with an address that isn't theirs; someone
// removed can't log in at all. Used by every query that hands out tickets or
// categories, so the rule lives in one place.
export const canTakeTickets = and(isNull(users.deactivatedAt), eq(users.emailVerified, true));

// Lists the people in one company, oldest first, removed ones included (with
// removedAt set) so pages can show them apart.
// Users are created by Better Auth (see lib/auth.ts), not by this file.
export async function getUsersInCompany(
  companyId: string,
): Promise<CompanyUser[]> {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      emailConfirmed: users.emailVerified,
      removedAt: users.deactivatedAt,
    })
    .from(users)
    .where(eq(users.companyId, companyId))
    .orderBy(asc(users.createdAt));
}

// Lists the people of one company who can be given a ticket (see
// canTakeTickets), oldest first: the "Assigned to" menu.
export async function getAssignableUsersInCompany(companyId: string): Promise<AssignableUser[]> {
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.companyId, companyId), canTakeTickets))
    .orderBy(asc(users.createdAt));
}

// Says whether this email already belongs to someone in this company, removed
// people included (their address stays taken).
// Company-scoped on purpose: it must not reveal accounts in other companies.
export async function isEmailInCompany(
  companyId: string,
  email: string,
): Promise<boolean> {
  const matches = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.email, email)));
  return matches.length > 0;
}

// Changes one person's display name. Returns false when there is no such user
// in this company (a user id from another company changes nothing).
export async function updateUserName(companyId: string, userId: string, name: string): Promise<boolean> {
  const updated = await db
    .update(users)
    .set({ name })
    .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
    .returning({ id: users.id });
  return updated.length > 0;
}

// How many browsers or devices this person is logged in on right now.
// sessions has no company_id (Better Auth's table), so the user is matched
// through users, inside this company only.
export async function countActiveSessions(companyId: string, userId: string): Promise<number> {
  const userInCompany = db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.companyId, companyId)));
  const [active] = await db
    .select({ total: count() })
    .from(sessions)
    .where(and(inArray(sessions.userId, userInCompany), gt(sessions.expiresAt, sql`now()`)));
  return active?.total ?? 0;
}

// Deletes every password reset link of this person, so a link sent earlier
// stops working once the password has changed. Better Auth keeps reset links
// in verifications with the user's id as the value and no company column, so
// the user is matched through users, inside this company only. (Email
// confirmation links are signed tokens that are never stored there.)
export async function deletePasswordResetLinks(companyId: string, userId: string): Promise<void> {
  const userInCompany = db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.companyId, companyId)));
  await db.delete(verifications).where(inArray(verifications.value, userInCompany));
}
