import "server-only";
import { hasAcceptedInviteFor } from "@/db/invites";
import { removeUnconfirmedAccount } from "@/db/unconfirmed-accounts";
import type { ResetLinkAccount } from "@/lib/password-reset-links";
import { notifyAssignee } from "./assignment-notifications";

// WHY a reset link removes an unconfirmed invitee's account instead of setting
// a password: joining through an invite link proves nothing about the inbox.
// The invite may have had a typo, or an owner may have invited someone else's
// address and joined with it themselves. Whoever owns the inbox gets the reset
// link, and a password would then let them confirm the address and be in that
// team. Removing the account means a stranger never lands in the team, and the
// address is free again: to sign up, or to be invited (and confirmed) again.
// Called by services/password-reset.ts only.

// Says whether this account joined its company through an invite and has
// never confirmed its address.
export async function isUnconfirmedInvitee(account: ResetLinkAccount): Promise<boolean> {
  if (account.emailVerified) {
    return false;
  }
  return hasAcceptedInviteFor(account.companyId, account.email);
}

// Removes such an account (one /db transaction that also routes its open
// tickets again), then emails whoever those tickets went to. companyId comes
// from the account the reset link belongs to (our users table), never from the
// request. Returns false when nothing was removed because the address was
// confirmed in the meantime.
export async function removeUnconfirmedInvitee(account: ResetLinkAccount): Promise<boolean> {
  const removal = await removeUnconfirmedAccount(account.companyId, account.id);
  if (!removal.removed) {
    return false;
  }
  for (const routed of removal.routedTickets) {
    await notifyAssignee({
      companyId: account.companyId,
      ticketId: routed.ticketId,
      assigneeUserId: routed.assigneeUserId,
      assignedByUserId: null,
    });
  }
  return true;
}
