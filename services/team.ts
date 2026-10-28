import "server-only";
import { getPendingInvitesForCompany, type PendingInvite } from "@/db/invites";
import { removeTeammate, setTeammateRole } from "@/db/team-members";
import { getAssignableUsersInCompany, getUsersInCompany, type AssignableUser, type CompanyUser } from "@/db/users";
import type { FormResult } from "@/lib/form-result";
import type { SessionContext } from "@/lib/session";
import { changeTeammateRoleSchema, removeTeammateSchema } from "@/lib/validation/team";
import { notifyRoutedAssignees } from "./assignment-notifications";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// Re-exported so pages can use the types without importing from /db.
export type { AssignableUser, CompanyUser, PendingInvite };

export type Team = {
  // Everyone still on the team, people who haven't confirmed yet included.
  members: CompanyUser[];
  // People an owner removed, most recent first. Old tickets keep their names.
  removedMembers: CompanyUser[];
  // Only owners invite people, remove them and change roles.
  canManageTeam: boolean;
  // Always empty for members: only owners may see pending invites.
  pendingInvites: PendingInvite[];
};

const onlyOwnersError: FormResult = { ok: false, errors: { message: "Only owners can remove people or change roles." } };
const notOnTeamError: FormResult = { ok: false, errors: { message: "That person is not on your team, or was already removed." } };
const tooManyChangesError: FormResult = { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };

// Lists who a ticket of the logged-in user's company can be assigned to:
// people who confirmed their email and were not removed.
export async function listAssigneeChoicesForSession(session: SessionContext): Promise<AssignableUser[]> {
  return getAssignableUsersInCompany(session.companyId);
}

// Gathers what the team page shows for the logged-in user's company.
export async function getTeamForSession(session: SessionContext): Promise<Team> {
  const isOwner = session.role === "owner";
  const [everyone, pendingInvites] = await Promise.all([
    getUsersInCompany(session.companyId),
    isOwner ? getPendingInvitesForCompany(session.companyId) : [],
  ]);
  const removedMembers = everyone
    .filter((person) => person.removedAt !== null)
    .sort((first, second) => (second.removedAt?.getTime() ?? 0) - (first.removedAt?.getTime() ?? 0));

  return {
    members: everyone.filter((person) => person.removedAt === null),
    removedMembers,
    canManageTeam: isOwner,
    pendingInvites,
  };
}

// Removes a teammate from the session's company. Owners only, never yourself.
// They are logged out everywhere at once and can't log in again, and their
// open tickets go back to routing; whoever gets one is emailed. Someone who
// never confirmed their email is deleted instead, which frees the address.
export async function removeTeammateForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  if (session.role !== "owner") {
    return onlyOwnersError;
  }
  const parsed = removeTeammateSchema.safeParse(input);
  if (!parsed.success) {
    return notOnTeamError;
  }
  if (parsed.data.userId === session.userId) {
    return { ok: false, errors: { message: "You can't remove yourself. Another owner can." } };
  }
  if (await isOverSettingsLimit(session)) {
    return tooManyChangesError;
  }

  const removal = await removeTeammate(session.companyId, session.userId, parsed.data.userId);
  if (!removal.removed) {
    return notOnTeamError;
  }
  // Routing gave their open tickets to others: tell them, now that it is saved (step 13).
  await notifyRoutedAssignees(session.companyId, removal.routedTickets);
  return { ok: true };
}

// Makes a teammate of the session's company an owner or a member. Owners only,
// never your own role, only for confirmed people still on the team, and the
// company always keeps an owner. Making someone a member also revokes the
// pending invites they created. It applies from their next click: every
// request reads the role from the database.
export async function changeTeammateRoleForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  if (session.role !== "owner") {
    return onlyOwnersError;
  }
  const parsed = changeTeammateRoleSchema.safeParse(input);
  if (!parsed.success) {
    return notOnTeamError;
  }
  if (parsed.data.userId === session.userId) {
    return { ok: false, errors: { message: "You can't change your own role. Another owner can." } };
  }
  if (await isOverSettingsLimit(session)) {
    return tooManyChangesError;
  }

  const changed = await setTeammateRole(session.companyId, session.userId, parsed.data.userId, parsed.data.role);
  if (!changed) {
    return {
      ok: false,
      errors: { message: "That person's role can't be changed: they are not on your team, were removed, or haven't confirmed their email yet." },
    };
  }
  return { ok: true };
}

// The same counter as categories and company setup (services/categories.ts).
function isOverSettingsLimit(session: SessionContext): Promise<boolean> {
  return isOverRateLimit("settings-changes", session.userId, RATE_LIMITS.settingsChangesPerUser);
}
