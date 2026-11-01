import type { UserRole } from "@/db/schema";

// The company's people as the Team page and a ticket's assignee menu read them.

export type CompanyUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  // false until they open the link in their confirmation email (step 12).
  emailConfirmed: boolean;
  // When an owner removed them from the team, or null (db/team-members.ts).
  removedAt: Date | null;
};

export type AssignableUser = {
  id: string;
  name: string;
  // Shown next to names two teammates share, so the menu tells them apart.
  email: string;
};
