// Invite checks: an invite always lands the user in the inviting company with
// the invited role, bad links never work, and only owners of the right company
// can manage invites.

import assert from "node:assert/strict";
import { like } from "drizzle-orm";
import { db } from "@/db/client";
import { createInvite, getInvitePreviewByTokenHash, getPendingInvitesForCompany } from "@/db/invites";
import { companies } from "@/db/schema";
import { generateInviteToken, hashInviteToken } from "@/lib/invite-token";
import { createMembershipForNewUser } from "@/services/company-membership";
import { createInviteForSession, revokeInviteForSession } from "@/services/invites";
import { getTeamForSession } from "@/services/team";
import { check, runId, sessionFor, signUpWithBody, testEmail, testPassword, type TestUser } from "./helpers";

const INVITE_NOT_USABLE = /This invite is not valid, already used, revoked or expired/;

// Creates an invite as `owner` and returns the token from the link.
async function inviteAs(owner: TestUser, email: string, role: "owner" | "member") {
  const result = await createInviteForSession(sessionFor(owner), { email, role });
  if (!result.ok) {
    throw new Error(`Could not create invite: ${JSON.stringify(result.errors)}`);
  }
  return result.inviteLink.split("#")[1];
}

function joinWithToken(email: string, inviteToken: string) {
  return signUpWithBody({ name: "Invited", email, password: testPassword, inviteToken });
}

async function findPendingInviteId(owner: TestUser, email: string): Promise<string> {
  const pending = await getPendingInvitesForCompany(owner.companyId);
  const invite = pending.find((candidate) => candidate.email === email);
  assert.ok(invite, `no pending invite for ${email}`);
  return invite.id;
}

export async function runInviteChecks(ownerA: TestUser, ownerB: TestUser) {
  const memberEmail = testEmail("invited-member");
  const memberToken = await inviteAs(ownerA, memberEmail, "member");
  let member: TestUser | undefined;

  await check("an owner's invite link carries a token for the right company and email", async () => {
    assert.match(memberToken, /^[A-Za-z0-9_-]{43}$/);
    const preview = await getInvitePreviewByTokenHash(hashInviteToken(memberToken));
    assert.equal(preview?.companyName, `Isolation test a ${runId}`);
    assert.equal(preview?.email, memberEmail);
  });

  await check("joining with an invite lands in the inviting company with the invited role", async () => {
    member = await joinWithToken(memberEmail, memberToken);
    assert.equal(member.companyId, ownerA.companyId);
    assert.equal(member.role, "member");
  });

  await check("an owner invite gives the owner role", async () => {
    const email = testEmail("invited-owner");
    const coOwner = await joinWithToken(email, await inviteAs(ownerA, email, "owner"));
    assert.equal(coOwner.companyId, ownerA.companyId);
    assert.equal(coOwner.role, "owner");
  });

  await check("an invite link works only once", async () => {
    await assert.rejects(createMembershipForNewUser({ inviteToken: memberToken }, memberEmail), INVITE_NOT_USABLE);
  });

  await check("an invite only works for the email it was sent to", async () => {
    const invitedEmail = testEmail("right-email");
    const token = await inviteAs(ownerA, invitedEmail, "member");
    await assert.rejects(joinWithToken(testEmail("wrong-email"), token), INVITE_NOT_USABLE);
    // The failed attempt must not have used up the invite.
    const rightPerson = await joinWithToken(invitedEmail, token);
    assert.equal(rightPerson.companyId, ownerA.companyId);
  });

  await check("a revoked invite cannot be used", async () => {
    const email = testEmail("revoked");
    const token = await inviteAs(ownerA, email, "member");
    const revoked = await revokeInviteForSession(sessionFor(ownerA), { inviteId: await findPendingInviteId(ownerA, email) });
    assert.equal(revoked.ok, true);
    await assert.rejects(joinWithToken(email, token), INVITE_NOT_USABLE);
  });

  await check("an expired invite cannot be used", async () => {
    const email = testEmail("expired");
    const token = generateInviteToken();
    await createInvite(ownerA.companyId, {
      email,
      role: "member",
      tokenHash: hashInviteToken(token),
      createdByUserId: ownerA.id,
      expiresAt: new Date(Date.now() - 60 * 1000),
    });
    await assert.rejects(joinWithToken(email, token), INVITE_NOT_USABLE);
  });

  await check("a made-up invite token fails and never falls back to creating a company", async () => {
    await assert.rejects(
      signUpWithBody({
        name: "Guesser",
        email: testEmail("guesser"),
        password: testPassword,
        inviteToken: generateInviteToken(),
        companyName: `Fallback company ${runId}`,
      }),
      INVITE_NOT_USABLE,
    );
    const fallback = await db.select().from(companies).where(like(companies.name, `Fallback company ${runId}`));
    assert.equal(fallback.length, 0);
  });

  await check("a member cannot create or revoke invites", async () => {
    assert.ok(member, "member was not created by an earlier check");
    const created = await createInviteForSession(sessionFor(member), { email: testEmail("by-member"), role: "member" });
    assert.equal(created.ok, false);
    const email = testEmail("pending-for-member-test");
    await inviteAs(ownerA, email, "member");
    const revoked = await revokeInviteForSession(sessionFor(member), { inviteId: await findPendingInviteId(ownerA, email) });
    assert.equal(revoked.ok, false);
  });

  await check("owner B cannot revoke company A's invite", async () => {
    const email = testEmail("a-pending");
    await inviteAs(ownerA, email, "member");
    const inviteId = await findPendingInviteId(ownerA, email);
    const revoked = await revokeInviteForSession(sessionFor(ownerB), { inviteId });
    assert.equal(revoked.ok, false);
    assert.equal(await findPendingInviteId(ownerA, email), inviteId);
  });

  await check("company B's team page never shows company A's members or invites", async () => {
    const teamB = await getTeamForSession(sessionFor(ownerB));
    assert.deepEqual(teamB.members.map((user) => user.id), [ownerB.id]);
    assert.deepEqual(teamB.pendingInvites, []);
  });

  await check("an invite cannot be created for someone already on the team", async () => {
    const result = await createInviteForSession(sessionFor(ownerA), { email: ownerA.email, role: "member" });
    assert.equal(result.ok, false);
  });
}
