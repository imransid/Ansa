import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "./client";
import { revokePendingInvitesCreatedBy } from "./invites";
import { routeTicketsAgain, type RoutedTicket } from "./routing";
import { accounts, sessions, tickets, userCategories, users, verifications } from "./schema";
import { disconnectMemberProfilesOf } from "./social-connection-disconnects";
import { recordTicketChanges } from "./ticket-activity";

// Takes away everything a confirmed teammate could still use, inside the
// caller's transaction: their logins, password, reset links, categories,
// pending invites and the LinkedIn profiles they connected (step 40: those
// post as them), and their open tickets, which are routed again. Only for
// db/team-members.ts, right after its UPDATE marked this person removed.
// Returns who got which ticket, so they can be emailed after commit.
export async function endTeammateAccess(tx: DbTransaction, companyId: string, teammateId: string): Promise<RoutedTicket[]> {
  await endLoginsAndLinks(tx, companyId, teammateId);
  await tx
    .delete(userCategories)
    .where(and(eq(userCategories.companyId, companyId), eq(userCategories.userId, teammateId)));
  await revokePendingInvitesCreatedBy(tx, companyId, teammateId);
  await disconnectMemberProfilesOf(tx, companyId, teammateId, "teammate_removed");
  const openTicketIds = await unassignOpenTickets(tx, companyId, teammateId);
  return routeTicketsAgain(tx, companyId, openTicketIds);
}

// Logs them out everywhere at once (Better Auth reads the sessions table on
// every request; there is no cookie cache), deletes their password (nothing
// may log in with it again, so there is no reason to keep its hash) and kills
// any reset link already in their inbox. These tables have no company column,
// so the user is matched through users, inside this company only.
async function endLoginsAndLinks(tx: DbTransaction, companyId: string, teammateId: string): Promise<void> {
  await tx.delete(sessions).where(inArray(sessions.userId, userInCompany(tx, companyId, teammateId)));
  await tx.delete(accounts).where(inArray(accounts.userId, userInCompany(tx, companyId, teammateId)));
  await tx.delete(verifications).where(inArray(verifications.value, userInCompany(tx, companyId, teammateId)));
}

// Takes their open tickets off them, each recorded in its history as done by
// the app (actor empty), not by a person. routed_to_user_id stays: it records
// routing's first pick for good. Returns the tickets oldest first, so routing
// hands them out in the order they came in.
async function unassignOpenTickets(tx: DbTransaction, companyId: string, teammateId: string): Promise<string[]> {
  const unassigned = await tx
    .update(tickets)
    .set({ assignedToUserId: null, assignedAutomatically: null })
    .where(and(eq(tickets.companyId, companyId), eq(tickets.assignedToUserId, teammateId), eq(tickets.status, "open")))
    .returning({ id: tickets.id, ticketNumber: tickets.ticketNumber });
  const changes = unassigned.map((ticket) => ({
    ticketId: ticket.id,
    kind: "unassigned" as const,
    actorUserId: null,
    targetUserId: teammateId,
  }));
  await recordTicketChanges(tx, companyId, changes);
  return unassigned.sort((first, second) => first.ticketNumber - second.ticketNumber).map((ticket) => ticket.id);
}

function userInCompany(tx: DbTransaction, companyId: string, userId: string) {
  return tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.companyId, companyId)));
}
