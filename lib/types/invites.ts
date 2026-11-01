import type { UserRole } from "@/db/schema";

// Invites as the Team page lists them, and what the join page learns about
// an invite link.

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

// What the join page learns about an invite link. "rate-limited" is separate
// so a busy shared office IP isn't told that a good invite is dead.
export type InvitePreviewResult =
  | { status: "ready"; preview: InvitePreview }
  | { status: "not-usable" }
  | { status: "rate-limited" };
