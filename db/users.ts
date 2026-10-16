import "server-only";
import { asc, eq } from "drizzle-orm";
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
