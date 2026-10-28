import "server-only";
import { and, asc, count, eq, exists, inArray, isNull, sql } from "drizzle-orm";
import type { DbTransaction } from "./client";
import { findSameCustomerAssignee } from "./same-customer";
import { categories, tickets, userCategories, users } from "./schema";
import { recordTicketChange } from "./ticket-activity";
import { canTakeTickets } from "./users";

export type RoutedTicket = {
  ticketId: string;
  assigneeUserId: string;
};

// Picks who should get a ticket in this category: of the company's people who
// handle the category (and only if it is active), the one with the fewest open
// tickets assigned to them; ties go to whoever joined first. People who can't
// take tickets (unconfirmed or removed, see canTakeTickets) are never picked.
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
        canTakeTickets,
      ),
    )
    .groupBy(users.id, users.createdAt)
    .orderBy(asc(count(tickets.id)), asc(users.createdAt))
    .limit(1);
  return expert?.userId ?? null;
}

// Routes one unassigned ticket of one company to the right expert for its
// category, inside the caller's transaction. Does nothing if the ticket is
// already assigned (routing never takes a ticket away from someone), is not
// open (a solved ticket needs nobody), has no category, or nobody handles the
// category. Returns who got it, or null.
// Call it only in a transaction that FIRST took the company's row lock
// (lockCompanyRow in db/company-lock.ts, or creating a ticket, which takes the
// same lock). WHY: pickExpertForCategory counts open tickets without locking,
// so two routings at the same moment would both see the same "least busy"
// expert and both pick them. With the lock they run one at a time.
export async function routeTicketIfUnassigned(
  tx: DbTransaction,
  companyId: string,
  ticketId: string,
): Promise<string | null> {
  const [ticket] = await tx
    .select({ status: tickets.status, category: tickets.category, assignedToUserId: tickets.assignedToUserId })
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), eq(tickets.companyId, companyId)))
    // Lock the row so two routings of the same ticket can't both assign it,
    // and a solve being saved at this moment is waited for, then seen.
    .for("update");
  if (!ticket || ticket.status !== "open" || ticket.assignedToUserId || !ticket.category) {
    return null;
  }

  const expertId = await pickExpertForCategory(tx, companyId, ticket.category);
  if (!expertId) {
    return null;
  }
  return (await assignRoutedTicket(tx, companyId, ticketId, expertId, ticket.category)) ? expertId : null;
}

// Routes a NEW ticket of one company, inside the transaction that created it
// (which holds the company's row lock, see routeTicketIfUnassigned). When the
// same customer (phone number or email, db/same-customer.ts) already has an
// open ticket with someone who can take tickets, the new one goes to that
// person, whatever its category, so a customer who calls back deals with the
// same expert (step 29). Otherwise it is routed by category. Returns who got
// it, or null.
export async function routeNewTicket(tx: DbTransaction, companyId: string, ticketId: string): Promise<string | null> {
  const sameCustomerAssignee = await findSameCustomerAssignee(tx, companyId, ticketId);
  // No category: this pick followed the customer, not a category.
  if (sameCustomerAssignee && (await assignRoutedTicket(tx, companyId, ticketId, sameCustomerAssignee, null))) {
    return sameCustomerAssignee;
  }
  return routeTicketIfUnassigned(tx, companyId, ticketId);
}

// Routes each ticket again by its category (only new tickets look for the same
// customer first), inside the caller's transaction (which must hold the
// company's row lock, see routeTicketIfUnassigned). Returns who got which
// ticket, so they can be emailed after commit.
export async function routeTicketsAgain(tx: DbTransaction, companyId: string, ticketIds: string[]): Promise<RoutedTicket[]> {
  const routedTickets: RoutedTicket[] = [];
  for (const ticketId of ticketIds) {
    const assigneeUserId = await routeTicketIfUnassigned(tx, companyId, ticketId);
    if (assigneeUserId) {
      routedTickets.push({ ticketId, assigneeUserId });
    }
  }
  return routedTickets;
}

// Routes one company's open unassigned tickets in these categories, oldest
// first, inside the caller's transaction (which must hold the company's row
// lock, see routeTicketIfUnassigned). For when someone starts handling
// categories or a category is restored (step 29): tickets that came in while
// nobody handled their category would otherwise wait forever. Returns who got
// which ticket, so they can be emailed after commit.
export async function routeUnassignedTicketsInCategories(
  tx: DbTransaction,
  companyId: string,
  categoryIds: string[],
): Promise<RoutedTicket[]> {
  if (categoryIds.length === 0) {
    return [];
  }
  const waiting = await tx
    .select({ id: tickets.id })
    .from(tickets)
    .innerJoin(categories, and(eq(categories.companyId, tickets.companyId), eq(categories.name, tickets.category)))
    .where(
      and(
        eq(tickets.companyId, companyId),
        eq(tickets.status, "open"),
        isNull(tickets.assignedToUserId),
        inArray(categories.id, categoryIds),
      ),
    )
    .orderBy(asc(tickets.ticketNumber));
  return routeTicketsAgain(tx, companyId, waiting.map((ticket) => ticket.id));
}

// Gives an unassigned ticket to the expert routing picked, recorded as
// automatic, and adds a "routed" row to its history with the category routing
// followed (null: the same customer's other open ticket), so the history keeps
// why even after the category changes. Returns false, changing nothing, when
// the ticket got an assignee meanwhile, or the expert can't take tickets any
// more (removed at this very moment): the ticket then stays unassigned rather
// than land on someone who can't log in.
async function assignRoutedTicket(tx: DbTransaction, companyId: string, ticketId: string, expertId: string, followedCategory: string | null): Promise<boolean> {
  const routed = await tx
    .update(tickets)
    .set({
      assignedToUserId: expertId,
      assignedAutomatically: true,
      // Only the first routing is remembered; see tickets.routed_to_user_id.
      routedToUserId: sql`coalesce(${tickets.routedToUserId}, ${expertId})`,
    })
    .where(
      and(
        eq(tickets.id, ticketId),
        eq(tickets.companyId, companyId),
        isNull(tickets.assignedToUserId),
        expertCanStillTakeTickets(tx, companyId, expertId),
      ),
    )
    .returning({ id: tickets.id });
  if (routed.length === 0) {
    return false;
  }
  await recordTicketChange(tx, companyId, { ticketId, kind: "routed", actorUserId: null, targetUserId: expertId, category: followedCategory });
  return true;
}

// WHY the lock: pickExpertForCategory reads without locking, so it can pick
// someone whose removal is being saved at that very moment. Locking their row
// makes this statement wait for that removal and then check again; without it
// the ticket could land on the removed person after their tickets were moved.
function expertCanStillTakeTickets(tx: DbTransaction, companyId: string, expertId: string) {
  return exists(
    tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, expertId), eq(users.companyId, companyId), canTakeTickets))
      .for("share"),
  );
}
