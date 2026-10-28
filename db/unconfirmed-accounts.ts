import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, type DbTransaction } from "./client";
import { lockCompanyRow } from "./company-lock";
import { routeTicketsAgain, type RoutedTicket } from "./routing";
import { tickets, userCategories, users, verifications } from "./schema";
import { clearDeletedAccountFromHistory, recordTicketChanges } from "./ticket-activity";

export type { RoutedTicket };

export type UnconfirmedAccountRemoval =
  | { removed: false }
  | { removed: true; routedTickets: RoutedTicket[] };

// Deletes an account of this company that never confirmed its address, in ONE
// transaction: its categories, its place on tickets (open ones are routed
// again) and its name in their history, its password reset links, then the
// account itself. Its login and
// sessions go with it (ON DELETE CASCADE). Changes nothing when the account is
// not (or no longer) an unconfirmed member of this company.
// Only for accounts that never logged in: they can't have solved tickets,
// uploaded documents, written knowledge articles, confirmed business facts,
// answered the Co-Founder's interview or created invites, whose foreign keys
// would refuse this.
export async function removeUnconfirmedAccount(
  companyId: string,
  userId: string,
): Promise<UnconfirmedAccountRemoval> {
  return db.transaction(async (tx) => {
    // First: its open tickets are routed again, and routing must not run at
    // the same time as another routing in this company (db/routing.ts).
    await lockCompanyRow(tx, companyId);
    return removeUnconfirmedAccountInTransaction(tx, companyId, userId);
  });
}

// The same, inside a transaction the caller already opened that holds the
// company's row lock (an owner removing someone who never confirmed,
// db/team-members.ts).
export async function removeUnconfirmedAccountInTransaction(
  tx: DbTransaction,
  companyId: string,
  userId: string,
): Promise<UnconfirmedAccountRemoval> {
  const [account] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.companyId, companyId), eq(users.emailVerified, false)))
    // Locked: confirming the address at the same moment waits for this
    // transaction, then finds no account to confirm.
    .for("update");
  if (!account) {
    return { removed: false };
  }

  await tx
    .delete(userCategories)
    .where(and(eq(userCategories.companyId, companyId), eq(userCategories.userId, userId)));
  const openTicketIds = await takeAccountOffTickets(tx, companyId, userId);
  const routedTickets = await routeTicketsAgain(tx, companyId, openTicketIds);
  await clearDeletedAccountFromHistory(tx, companyId, userId);
  await deleteResetLinks(tx, companyId, userId);
  await tx
    .delete(users)
    .where(and(eq(users.id, userId), eq(users.companyId, companyId), eq(users.emailVerified, false)));
  return { removed: true, routedTickets };
}

// The same-company foreign keys refuse to delete an account that tickets still
// point at. routed_to_user_id is cleared too, although it is otherwise never
// overwritten: routing's pick was someone who never confirmed. Each ticket's
// history records the unassignment as done by the app, without naming the
// account (it is deleted next). Returns the open tickets that lost their assignee.
async function takeAccountOffTickets(tx: DbTransaction, companyId: string, userId: string): Promise<string[]> {
  await tx
    .update(tickets)
    .set({ routedToUserId: null })
    .where(and(eq(tickets.companyId, companyId), eq(tickets.routedToUserId, userId)));
  const unassigned = await tx
    .update(tickets)
    .set({ assignedToUserId: null, assignedAutomatically: null })
    .where(and(eq(tickets.companyId, companyId), eq(tickets.assignedToUserId, userId)))
    .returning({ id: tickets.id, status: tickets.status });
  const changes = unassigned.map((ticket) => ({
    ticketId: ticket.id,
    kind: "unassigned" as const,
    actorUserId: null,
    targetUserId: null,
  }));
  await recordTicketChanges(tx, companyId, changes);
  return unassigned.filter((ticket) => ticket.status === "open").map((ticket) => ticket.id);
}

// Better Auth keeps reset links in verifications with the user's id as the
// value and no company column, so the user is matched through users, inside
// this company only.
async function deleteResetLinks(tx: DbTransaction, companyId: string, userId: string): Promise<void> {
  const userInCompany = tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.companyId, companyId)));
  await tx.delete(verifications).where(inArray(verifications.value, userInCompany));
}
