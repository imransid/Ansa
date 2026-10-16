import "server-only";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import type { DbTransaction } from "./client";
import { categories, tickets, userCategories, users } from "./schema";

// Picks who should get a ticket in this category: of the company's people who
// handle the category (and only if it is active), the one with the fewest open
// tickets assigned to them; ties go to whoever joined first.
// Returns null when nobody in the company handles it.
// Swap this function to change the routing rule; nothing else needs to change.
export async function pickExpertForCategory(
  tx: DbTransaction,
  companyId: string,
  categoryName: string,
): Promise<string | null> {
  const [expert] = await tx
    .select({ userId: users.id })
    .from(userCategories)
    .innerJoin(
      categories,
      and(eq(categories.id, userCategories.categoryId), eq(categories.companyId, userCategories.companyId)),
    )
    .innerJoin(users, and(eq(users.id, userCategories.userId), eq(users.companyId, userCategories.companyId)))
    .leftJoin(
      tickets,
      and(
        eq(tickets.assignedToUserId, users.id),
        eq(tickets.companyId, users.companyId),
        eq(tickets.status, "open"),
      ),
    )
    .where(
      and(
        eq(userCategories.companyId, companyId),
        eq(categories.name, categoryName),
        isNull(categories.archivedAt),
      ),
    )
    .groupBy(users.id, users.createdAt)
    .orderBy(asc(count(tickets.id)), asc(users.createdAt))
    .limit(1);
  return expert?.userId ?? null;
}

// Routes one unassigned ticket of one company to the right expert for its
// category, inside the caller's transaction. Does nothing if the ticket is
// already assigned (routing never takes a ticket away from someone), has no
// category, or nobody handles the category. Returns who got it, or null.
export async function routeTicketIfUnassigned(
  tx: DbTransaction,
  companyId: string,
  ticketId: string,
): Promise<string | null> {
  const [ticket] = await tx
    .select({ category: tickets.category, assignedToUserId: tickets.assignedToUserId })
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), eq(tickets.companyId, companyId)))
    // Lock the row so two routings of the same ticket can't both assign it.
    .for("update");
  if (!ticket || ticket.assignedToUserId || !ticket.category) {
    return null;
  }

  const expertId = await pickExpertForCategory(tx, companyId, ticket.category);
  if (!expertId) {
    return null;
  }
  await tx
    .update(tickets)
    .set({
      assignedToUserId: expertId,
      assignedAutomatically: true,
      // Only the first routing is remembered; see tickets.routed_to_user_id.
      routedToUserId: sql`coalesce(${tickets.routedToUserId}, ${expertId})`,
    })
    .where(and(eq(tickets.id, ticketId), eq(tickets.companyId, companyId), isNull(tickets.assignedToUserId)));
  return expertId;
}
