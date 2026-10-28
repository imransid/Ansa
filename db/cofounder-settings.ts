import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { canManageMarketingStrategy } from "@/lib/cofounder/permissions";
import { db } from "./client";
import { lockCompanyRow } from "./company-lock";
import { lockActiveAuthorRole } from "./knowledge-author";
import { companies } from "./schema";

// The Co-Founder's setting of one company (step 37): whether its marketing
// plans also get its ticket counts per category (db/support-trends.ts).
// Only an active owner changes it: the role is read again, locked, in the
// transaction that writes (db/knowledge-author.ts).

// Whether one company's plans may read its support trends (off by default).
export async function getSupportTrendsSetting(companyId: string): Promise<boolean> {
  const [company] = await db
    .select({ usesSupportTrends: companies.cofounderUsesSupportTrends })
    .from(companies)
    .where(eq(companies.id, companyId));
  return company?.usesSupportTrends ?? false;
}

// Turns one company's support-trends setting on or off, while actorUserId
// is an active owner of it. "unchanged": it was already so.
export async function setSupportTrendsSetting(
  companyId: string,
  actorUserId: string,
  enabled: boolean,
): Promise<"changed" | "unchanged" | "not-allowed"> {
  return db.transaction(async (tx) => {
    // The company row before the person's (db/company-lock.ts): the UPDATE
    // below locks the company row too, and a role change takes the two in
    // this order, so the two can never wait for each other.
    await lockCompanyRow(tx, companyId);
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    if (!role || !canManageMarketingStrategy(role)) {
      return "not-allowed";
    }
    const changed = await tx
      .update(companies)
      .set({ cofounderUsesSupportTrends: enabled })
      .where(and(eq(companies.id, companyId), ne(companies.cofounderUsesSupportTrends, enabled)))
      .returning({ id: companies.id });
    return changed.length > 0 ? "changed" : "unchanged";
  });
}
