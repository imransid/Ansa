import "server-only";
import { and, asc, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "./client";
import { tickets } from "./schema";

// The only support data the Co-Founder may ever read (step 37), and only
// while an owner has turned that on (db/cofounder-settings.ts): how many of
// one company's tickets each category had. Category names and numbers only:
// this read never selects a ticket's subject, text, notes or customer.

export type CategoryTicketCount = { category: string; ticketCount: number };

// One company's tickets created in the last `days` days, counted per
// category (tickets without one left out), the most first, at most `limit`
// categories. A category archived since still counts: its tickets were real.
export async function countRecentTicketsPerCategory(companyId: string, days: number, limit: number): Promise<CategoryTicketCount[]> {
  const ticketCount = count();
  const rows = await db
    .select({ category: tickets.category, ticketCount })
    .from(tickets)
    .where(
      and(
        eq(tickets.companyId, companyId),
        isNotNull(tickets.category),
        gte(tickets.createdAt, sql`now() - make_interval(days => ${days})`),
      ),
    )
    .groupBy(tickets.category)
    .orderBy(desc(ticketCount), asc(tickets.category))
    .limit(limit);
  return rows.flatMap((row) => (row.category ? [{ category: row.category, ticketCount: row.ticketCount }] : []));
}
