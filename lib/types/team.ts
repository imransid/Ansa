import type { PendingInvite } from "@/lib/types/invites";
import type { CompanyUser } from "@/lib/types/users";

// What the Team page shows.

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
