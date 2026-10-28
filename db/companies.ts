import "server-only";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { companies } from "./schema";

export type Company = typeof companies.$inferSelect;

// Inserts a new company. Not company-scoped on purpose: the company does not
// exist yet, so there is no companyId. Only called while signing up a new owner.
export async function createCompany(name: string): Promise<Company> {
  const [company] = await db.insert(companies).values({ name }).returning();
  return company;
}

// Reads the session's own company. companyId must come from the session.
export async function getCompanyById(
  companyId: string,
): Promise<Company | undefined> {
  const [company] = await db
    .select()
    .from(companies)
    .where(eq(companies.id, companyId));
  return company;
}

// Renames the session's own company. The name is also the sender name of its
// customer emails. companyId must come from the session.
export async function updateCompanyName(companyId: string, name: string): Promise<void> {
  await db.update(companies).set({ name }).where(eq(companies.id, companyId));
}
