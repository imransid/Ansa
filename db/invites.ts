import "server-only";
import { and, asc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { db, type DbTransaction } from "./client";
import { companies, invites, users, type UserRole } from "./schema";

export type PendingInvite = {
  id: string;
  email: string;
  role: UserRole;
  expiresAt: Date;
};

export type InvitePreview = {
  companyName: string;
  email: string;
  role: UserRole;
};

type NewInvite = {
  email: string;
  role: UserRole;
  tokenHash: string;
  createdByUserId: string;
  expiresAt: Date;
};

// "Pending" = not accepted, not revoked, not expired. Used by every query below
// that must only touch invites that can still be used.
const isPending = and(
  isNull(invites.acceptedAt),
  isNull(invites.revokedAt),
  gt(invites.expiresAt, sql`now()`),
);

// Saves a new invite for one company, but only while the person creating it is
// still an active owner there. Returns undefined, saving nothing, otherwise.
export async function createInvite(
  companyId: string,
  invite: NewInvite,
): Promise<PendingInvite | undefined> {
  return db.transaction(async (tx) => {
    if (!(await lockCreatorIfActiveOwner(tx, companyId, invite.createdByUserId))) {
      return undefined;
    }
    const [created] = await tx
      .insert(invites)
      // Every column named, never a spread of `invite`: an object with extra
      // fields (a companyId of its own) can't write them.
      .values({
        companyId,
        email: invite.email,
        role: invite.role,
        tokenHash: invite.tokenHash,
        createdByUserId: invite.createdByUserId,
        expiresAt: invite.expiresAt,
      })
      .returning({
        id: invites.id,
        email: invites.email,
        role: invites.role,
        expiresAt: invites.expiresAt,
      });
    return created;
  });
}

// WHY: the creator's role comes from a session read when their request began.
// Removing an owner or making them a member revokes their pending invites
// (db/team-members.ts); an invite saved just after that would survive, and its
// link would let them walk back in. FOR SHARE waits for a removal or role
// change being saved on their row and then reads it again, and it holds the
// row until this invite is saved, so one starting now waits and then revokes it.
async function lockCreatorIfActiveOwner(tx: DbTransaction, companyId: string, userId: string): Promise<boolean> {
  const [creator] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.companyId, companyId), eq(users.role, "owner"), isNull(users.deactivatedAt)))
    .for("share");
  return creator !== undefined;
}

// Lists one company's invites that can still be used, oldest first.
export async function getPendingInvitesForCompany(
  companyId: string,
): Promise<PendingInvite[]> {
  return db
    .select({
      id: invites.id,
      email: invites.email,
      role: invites.role,
      expiresAt: invites.expiresAt,
    })
    .from(invites)
    .where(and(eq(invites.companyId, companyId), isPending))
    .orderBy(asc(invites.createdAt));
}

// Revokes one pending invite of one company. Returns false if there was no such
// pending invite in that company (wrong id, other company, already used or revoked).
export async function revokeInvite(
  companyId: string,
  inviteId: string,
): Promise<boolean> {
  const revoked = await db
    .update(invites)
    .set({ revokedAt: sql`now()` })
    .where(
      and(eq(invites.id, inviteId), eq(invites.companyId, companyId), isPending),
    )
    .returning({ id: invites.id });
  return revoked.length > 0;
}

// Revokes every pending invite one person created in one company, inside the
// caller's transaction (removing that person or making them a member,
// db/team-members.ts). Otherwise a departing or demoted owner could invite a
// private address and walk back in, as an owner if they picked that role.
export async function revokePendingInvitesCreatedBy(
  tx: DbTransaction,
  companyId: string,
  userId: string,
): Promise<void> {
  await tx
    .update(invites)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(invites.companyId, companyId), eq(invites.createdByUserId, userId), isPending));
}

// Not company-scoped on purpose: the person opening an invite link has no
// session yet. The token is the proof; only its unguessable hash is looked up.
export async function getInvitePreviewByTokenHash(
  tokenHash: string,
): Promise<InvitePreview | undefined> {
  const [preview] = await db
    .select({
      companyName: companies.name,
      email: invites.email,
      role: invites.role,
    })
    .from(invites)
    .innerJoin(companies, eq(companies.id, invites.companyId))
    .where(and(eq(invites.tokenHash, tokenHash), isPending));
  return preview;
}

// Marks a pending invite as used and returns which company and role it grants.
// Returns undefined if the token is unknown, used, revoked, expired, or for another email.
// Not company-scoped for the same reason as getInvitePreviewByTokenHash.
export async function claimInvite(
  tokenHash: string,
  email: string,
): Promise<{ companyId: string; role: UserRole } | undefined> {
  // One UPDATE both checks and marks the invite, so if two people use the same
  // link at the same moment, only one of them gets a row back.
  const [claimed] = await db
    .update(invites)
    .set({ acceptedAt: sql`now()` })
    .where(
      and(eq(invites.tokenHash, tokenHash), eq(invites.email, email), isPending),
    )
    .returning({ companyId: invites.companyId, role: invites.role });
  return claimed;
}

// Says whether someone with this address joined this company through an invite
// (an invite for the address that was used). Signups that created their own
// company have none.
export async function hasAcceptedInviteFor(companyId: string, email: string): Promise<boolean> {
  const accepted = await db
    .select({ id: invites.id })
    .from(invites)
    .where(and(eq(invites.companyId, companyId), eq(invites.email, email), isNotNull(invites.acceptedAt)))
    .limit(1);
  return accepted.length > 0;
}
