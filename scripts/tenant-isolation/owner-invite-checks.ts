// Owner invite checks (step 23): an invite link only lives as long as its
// creator is an owner of the team. Making an owner a member revokes the links
// they created, as removing them does, and someone removed or made a member
// at the very moment they create an invite gets no link: otherwise a
// contractor made owner by mistake could invite a private address and walk
// back in, as an owner.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { createInvite, getPendingInvitesForCompany, revokePendingInvitesCreatedBy } from "@/db/invites";
import { users } from "@/db/schema";
import { generateInviteToken, hashInviteToken } from "@/lib/invite-token";
import { createInviteForSession, type CreateInviteResult } from "@/services/invites";
import { changeTeammateRoleForSession, removeTeammateForSession } from "@/services/team";
import { addTeammate, check, inviteAs, joinWithToken, sessionFor, signUpTestOwner, testEmail, type TestUser } from "./helpers";

const INVITE_NOT_USABLE = /This invite is not valid, already used, revoked or expired/;

function messageOf(result: CreateInviteResult): string {
  return result.ok ? "(it worked)" : (result.errors.message ?? "(no message)");
}

// An owner invite saved straight through /db, as `creator`, in `companyId`.
function ownerInviteBy(creator: TestUser, companyId: string, email: string) {
  return createInvite(companyId, {
    email,
    role: "owner",
    tokenHash: hashInviteToken(generateInviteToken()),
    createdByUserId: creator.id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
}

async function pendingInviteEmails(companyId: string): Promise<string[]> {
  return (await getPendingInvitesForCompany(companyId)).map((invite) => invite.email);
}

export async function runOwnerInviteChecks() {
  await check("owner invites: making an owner a member revokes the invites they created, owner invites included", async () => {
    const owner = await signUpTestOwner("owner-invites-demote");
    const contractor = await addTeammate(owner, "owner-invites-contractor", "owner");
    const accomplice = testEmail("owner-invites-accomplice");
    const accompliceToken = await inviteAs(contractor, accomplice, "owner");
    const ownersOwnInvite = testEmail("owner-invites-kept");
    await inviteAs(owner, ownersOwnInvite, "member");
    assert.deepEqual(await changeTeammateRoleForSession(sessionFor(owner), { userId: contractor.id, role: "member" }), { ok: true });
    // Only the demoted person's links stop working.
    assert.deepEqual(await pendingInviteEmails(owner.companyId), [ownersOwnInvite]);
    await assert.rejects(joinWithToken(accomplice, accompliceToken), INVITE_NOT_USABLE);
  });

  await check("owner invites: someone removed or made a member since their request began gets no invite link", async () => {
    const owner = await signUpTestOwner("owner-invites-stale");
    const leaver = await addTeammate(owner, "owner-invites-leaver", "owner");
    const demoted = await addTeammate(owner, "owner-invites-demoted", "owner");
    assert.deepEqual(await removeTeammateForSession(sessionFor(owner), { userId: leaver.id }), { ok: true });
    assert.deepEqual(await changeTeammateRoleForSession(sessionFor(owner), { userId: demoted.id, role: "member" }), { ok: true });
    // Their sessions were read before the change, so they still say "owner".
    const staleOwners = [["leaver", leaver], ["demoted", demoted]] as const;
    for (const [label, staleOwner] of staleOwners) {
      const tried = await createInviteForSession(sessionFor(staleOwner), { email: testEmail(`owner-invites-${label}-asks`), role: "owner" });
      assert.match(messageOf(tried), /Only owners can manage invites/, label);
      assert.equal(await ownerInviteBy(staleOwner, owner.companyId, testEmail(`owner-invites-${label}-db`)), undefined, label);
    }
    // An owner of one company can't create an invite in another one either.
    const otherCompany = await signUpTestOwner("owner-invites-other");
    assert.equal(await ownerInviteBy(owner, otherCompany.companyId, testEmail("owner-invites-elsewhere")), undefined);
    assert.deepEqual(await pendingInviteEmails(owner.companyId), []);
    assert.deepEqual(await pendingInviteEmails(otherCompany.companyId), []);
  });

  await check("owner invites: an invite created while its creator's removal is being saved waits for it, then is refused", async () => {
    const owner = await signUpTestOwner("owner-invites-race");
    const leaver = await addTeammate(owner, "owner-invites-race-leaver", "owner");
    // What db/team-members.ts does to the leaver's row, held open for a moment
    // while the leaver's own request tries to save an invite.
    const { attempt, wasStillWaiting } = await db.transaction(async (tx) => {
      await tx.update(users).set({ deactivatedAt: new Date() }).where(eq(users.id, leaver.id));
      await revokePendingInvitesCreatedBy(tx, owner.companyId, leaver.id);
      const attempt = ownerInviteBy(leaver, owner.companyId, testEmail("owner-invites-race-invitee"));
      let settled = false;
      attempt.then(
        () => (settled = true),
        () => (settled = true),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { attempt, wasStillWaiting: !settled };
    });
    assert.equal(wasStillWaiting, true, "the invite didn't wait for the removal being saved");
    assert.equal(await attempt, undefined, "an invite was saved after its creator was removed");
    assert.deepEqual(await pendingInviteEmails(owner.companyId), []);
  });
}
