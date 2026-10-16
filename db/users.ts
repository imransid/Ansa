import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "./client";
import { users, type UserRole } from "./schema";

export type CompanyUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

// Lists the people in one company, oldest first.
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
    })
    .from(users)
    .where(eq(users.companyId, companyId))
    .orderBy(asc(users.createdAt));
}

// Says whether this email already belongs to someone in this company.
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
