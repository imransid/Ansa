import "server-only";
import { and, eq, exists, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type DbTransaction } from "./client";
import { lockCompanyRow } from "./company-lock";
import { revokePendingInvitesCreatedBy } from "./invites";
import type { RoutedTicket } from "./routing";
import { users, type UserRole } from "./schema";
import { disconnectMemberProfilesOf } from "./social-connection-disconnects";
import { endTeammateAccess } from "./teammate-access";
import { removeUnconfirmedAccountInTransaction } from "./unconfirmed-accounts";

export type TeammateRemoval =
  | { removed: false }
  | { removed: true; routedTickets: RoutedTicket[] };

// Second and third views of the users table, for checks inside queries on it.
const actingOwner = alias(users, "acting_owner");
const otherOwner = alias(users, "other_owner");

// Removes one person from one company's team, in ONE transaction. Only an
// active owner of that company may do it, never to themselves, and only to
// someone still on the team. A confirmed teammate is deactivated: logged out
// everywhere, their password, categories, reset links and pending invites
// gone, their open tickets routed again. Their row stays, so tickets keep
// their name.
// Someone who never confirmed their email never logged in and has no history,
// so their account is deleted instead (as their own reset link would do, see
// db/unconfirmed-accounts.ts), which frees the address for a new invite.
// Returns who got which ticket, so they can be emailed after commit.
export async function removeTeammate(
  companyId: string,
  actingOwnerId: string,
  teammateId: string,
): Promise<TeammateRemoval> {
  return db.transaction(async (tx) => {
    // Every team change takes the company's row lock first (db/company-lock.ts),
    // so two owners can't remove or demote each other at the same moment and
    // leave nobody in charge. Routing their open tickets needs it too.
    await lockCompanyRow(tx, companyId);
    const teammate = await findRemovableTeammate(tx, companyId, actingOwnerId, teammateId);
    if (!teammate) {
      return { removed: false };
    }
    if (!teammate.emailConfirmed) {
      return removeUnconfirmedAccountInTransaction(tx, companyId, teammateId);
    }
    return deactivateTeammate(tx, companyId, actingOwnerId, teammateId);
  });
}

// Gives one teammate a new role, in ONE transaction. Only an active owner of
// that company may do it, never to themselves, and only to a confirmed
// teammate still on the team. A demotion also needs another active owner to
// remain, checked in the same statement, so a company always keeps one,
// revokes the pending invites they created and disconnects the LinkedIn
// profiles they connected. Returns false, changing nothing, otherwise.
export async function setTeammateRole(
  companyId: string,
  actingOwnerId: string,
  teammateId: string,
  role: UserRole,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    // See removeTeammate.
    await lockCompanyRow(tx, companyId);
    const changed = await tx
      .update(users)
      .set({ role })
      .where(
        and(
          eq(users.id, teammateId),
          eq(users.companyId, companyId),
          ne(users.id, actingOwnerId),
          isNull(users.deactivatedAt),
          eq(users.emailVerified, true),
          isActiveOwner(tx, companyId, actingOwnerId),
          role === "owner" ? undefined : anotherActiveOwnerRemains(tx, companyId, teammateId),
        ),
      )
      .returning({ id: users.id });
    if (changed.length === 0) {
      return false;
    }
    // Members can't manage invites, so nobody would answer for the links they
    // made as an owner, and one of those could bring them back as an owner.
    // Nor can they cancel posts or disconnect accounts, and their LinkedIn
    // profile posts AS them (step 41).
    if (role === "member") {
      await revokePendingInvitesCreatedBy(tx, companyId, teammateId);
      await disconnectMemberProfilesOf(tx, companyId, teammateId, "teammate_made_member");
    }
    return true;
  });
}

// The teammate to remove: in this company, not removed already, not the
// acting owner, and only while the acting owner is still an active owner
// here (an owner who was just demoted or removed can't act). It picks the
// branch (delete or deactivate); deactivateTeammate checks the rules again in
// its own UPDATE. Their row stays locked until the transaction ends, so
// assigning them a ticket at this moment waits and then sees them removed
// (db/ticket-updates.ts).
async function findRemovableTeammate(tx: DbTransaction, companyId: string, actingOwnerId: string, teammateId: string) {
  const [teammate] = await tx
    .select({ id: users.id, emailConfirmed: users.emailVerified })
    .from(users)
    .where(
      and(
        eq(users.id, teammateId),
        eq(users.companyId, companyId),
        isNull(users.deactivatedAt),
        ne(users.id, actingOwnerId),
        isActiveOwner(tx, companyId, actingOwnerId),
      ),
    )
    .for("no key update");
  return teammate;
}

// Removes a confirmed teammate without deleting anything they did. The user id
// comes from a form, so the UPDATE itself holds every rule (CLAUDE.md), and
// nothing else changes unless it matched. Returns who got their open tickets.
async function deactivateTeammate(
  tx: DbTransaction,
  companyId: string,
  actingOwnerId: string,
  teammateId: string,
): Promise<TeammateRemoval> {
  const deactivated = await tx
    .update(users)
    .set({ deactivatedAt: sql`now()` })
    .where(
      and(
        eq(users.id, teammateId),
        eq(users.companyId, companyId),
        isNull(users.deactivatedAt),
        eq(users.emailVerified, true),
        ne(users.id, actingOwnerId),
        isActiveOwner(tx, companyId, actingOwnerId),
      ),
    )
    .returning({ id: users.id });
  if (deactivated.length === 0) {
    return { removed: false };
  }
  return { removed: true, routedTickets: await endTeammateAccess(tx, companyId, teammateId) };
}

// The acting person is an owner of this company who was not removed.
function isActiveOwner(tx: DbTransaction, companyId: string, actingOwnerId: string) {
  return exists(
    tx
      .select({ id: actingOwner.id })
      .from(actingOwner)
      .where(
        and(
          eq(actingOwner.id, actingOwnerId),
          eq(actingOwner.companyId, companyId),
          eq(actingOwner.role, "owner"),
          isNull(actingOwner.deactivatedAt),
        ),
      ),
  );
}

// Someone other than the teammate being demoted is still a confirmed owner of
// this company who was not removed.
function anotherActiveOwnerRemains(tx: DbTransaction, companyId: string, teammateId: string) {
  return exists(
    tx
      .select({ id: otherOwner.id })
      .from(otherOwner)
      .where(
        and(
          eq(otherOwner.companyId, companyId),
          ne(otherOwner.id, teammateId),
          eq(otherOwner.role, "owner"),
          isNull(otherOwner.deactivatedAt),
          eq(otherOwner.emailVerified, true),
        ),
      ),
  );
}
