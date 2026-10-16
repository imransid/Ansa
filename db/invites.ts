import "server-only";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "./client";
import { companies, invites, type UserRole } from "./schema";

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

// Saves a new invite for one company.
export async function createInvite(
  companyId: string,
  invite: NewInvite,
): Promise<PendingInvite> {
  const [created] = await db
    .insert(invites)
    .values({ companyId, ...invite })
    .returning({
      id: invites.id,
      email: invites.email,
      role: invites.role,
      expiresAt: invites.expiresAt,
    });
  return created;
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
