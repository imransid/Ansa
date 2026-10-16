import "server-only";
import { getPendingInvitesForCompany, type PendingInvite } from "@/db/invites";
import { getUsersInCompany, type CompanyUser } from "@/db/users";
import type { SessionContext } from "@/lib/session";

// Re-exported so pages can use the types without importing from /db.
export type { CompanyUser, PendingInvite };

export type Team = {
  members: CompanyUser[];
  canManageInvites: boolean;
  // Always empty for members: only owners may see pending invites.
  pendingInvites: PendingInvite[];
};

// Lists everyone in the logged-in user's company (for example, to pick an assignee).
export async function listTeamMembersForSession(
  session: SessionContext,
): Promise<CompanyUser[]> {
  return getUsersInCompany(session.companyId);
}

// Gathers what the team page shows for the logged-in user's company.
export async function getTeamForSession(session: SessionContext): Promise<Team> {
  const isOwner = session.role === "owner";
  const [members, pendingInvites] = await Promise.all([
    getUsersInCompany(session.companyId),
    isOwner ? getPendingInvitesForCompany(session.companyId) : [],
  ]);

  return { members, canManageInvites: isOwner, pendingInvites };
}
