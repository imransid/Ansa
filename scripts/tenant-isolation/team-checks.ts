// Team control checks (step 23): only an active owner of the same company
// removes people or changes roles, never their own, and a company always
// keeps an owner, even when two owners act at the same moment. A new role
// applies from the person's next click.

import assert from "node:assert/strict";
import { removeTeammate, setTeammateRole } from "@/db/team-members";
import type { FormResult } from "@/lib/form-result";
import { getSessionContextFromHeaders } from "@/lib/session-context";
import { changeTeammateRoleForSession, removeTeammateForSession } from "@/services/team";
import { logInBrowser } from "./account-helpers";
import { addTeammate, check, sessionFor, signUpTestOwner, testPassword, type TestUser } from "./helpers";
import { joinWithoutConfirming, personRow } from "./team-helpers";

const ACTIVE_MEMBER = { role: "member", removedAt: null, confirmed: true };
const ACTIVE_OWNER = { role: "owner", removedAt: null, confirmed: true };

function messageOf(result: FormResult): string {
  return result.ok ? "(it worked)" : (result.errors.message ?? "(no message)");
}

// ownerB only proves that nothing reaches across companies; every check
// starts its own company, so the per-person change counters stay apart.
export async function runTeamChecks(ownerB: TestUser) {
  await check("team: another company's owner can't remove or demote anyone, through the service or /db", async () => {
    const owner = await signUpTestOwner("team-scope");
    const member = await addTeammate(owner, "team-scope-member", "member");
    const coOwner = await addTeammate(owner, "team-scope-co-owner", "owner");
    const asOwnerB = sessionFor(ownerB);
    assert.equal((await removeTeammateForSession(asOwnerB, { userId: member.id })).ok, false);
    assert.equal((await changeTeammateRoleForSession(asOwnerB, { userId: coOwner.id, role: "member" })).ok, false);
    assert.equal((await changeTeammateRoleForSession(asOwnerB, { userId: member.id, role: "owner" })).ok, false);
    // /db itself: B's company with A's people, and A's company with B acting.
    assert.deepEqual(await removeTeammate(ownerB.companyId, ownerB.id, member.id), { removed: false });
    assert.deepEqual(await removeTeammate(owner.companyId, ownerB.id, member.id), { removed: false });
    assert.equal(await setTeammateRole(owner.companyId, ownerB.id, coOwner.id, "member"), false);
    assert.equal(await setTeammateRole(ownerB.companyId, ownerB.id, member.id, "owner"), false);
    assert.deepEqual([await personRow(member.id), await personRow(coOwner.id)], [ACTIVE_MEMBER, ACTIVE_OWNER]);
  });

  await check("team: members can't remove anyone or change roles, even with a session that claims owner", async () => {
    const owner = await signUpTestOwner("team-member-try");
    const member = await addTeammate(owner, "team-member-try-1", "member");
    const otherMember = await addTeammate(owner, "team-member-try-2", "member");
    const asMember = sessionFor(member);
    assert.equal((await removeTeammateForSession(asMember, { userId: otherMember.id })).ok, false);
    assert.equal((await changeTeammateRoleForSession(asMember, { userId: member.id, role: "owner" })).ok, false);
    assert.equal((await changeTeammateRoleForSession(asMember, { userId: owner.id, role: "member" })).ok, false);
    // /db reads the real role, whatever the session says.
    const claimsOwner = { ...asMember, role: "owner" as const };
    assert.equal((await removeTeammateForSession(claimsOwner, { userId: otherMember.id })).ok, false);
    assert.equal((await changeTeammateRoleForSession(claimsOwner, { userId: otherMember.id, role: "owner" })).ok, false);
    assert.equal((await changeTeammateRoleForSession(claimsOwner, { userId: owner.id, role: "member" })).ok, false);
    assert.deepEqual([await personRow(otherMember.id), await personRow(owner.id)], [ACTIVE_MEMBER, ACTIVE_OWNER]);
  });

  await check("team: nobody removes themselves or changes their own role", async () => {
    const owner = await signUpTestOwner("team-self");
    await addTeammate(owner, "team-self-co-owner", "owner");
    const asOwner = sessionFor(owner);
    assert.match(messageOf(await removeTeammateForSession(asOwner, { userId: owner.id })), /can't remove yourself/);
    assert.match(messageOf(await changeTeammateRoleForSession(asOwner, { userId: owner.id, role: "member" })), /can't change your own role/);
    assert.deepEqual(await removeTeammate(owner.companyId, owner.id, owner.id), { removed: false });
    assert.equal(await setTeammateRole(owner.companyId, owner.id, owner.id, "member"), false);
    assert.deepEqual(await personRow(owner.id), ACTIVE_OWNER);
  });

  await check("team: the last owner stays an owner, and a demoted or removed owner can't act any more", async () => {
    const founder = await signUpTestOwner("team-last");
    const coOwner = await addTeammate(founder, "team-last-co-owner", "owner");
    const formerOwner = await addTeammate(founder, "team-last-former", "owner");
    // The co-owner removes one owner and demotes the founder: they are the last owner now.
    assert.deepEqual(await removeTeammateForSession(sessionFor(coOwner), { userId: formerOwner.id }), { ok: true });
    assert.deepEqual(await changeTeammateRoleForSession(sessionFor(coOwner), { userId: founder.id, role: "member" }), { ok: true });
    // Both still hold sessions that say "owner"; /db refuses them.
    for (const staleOwner of [founder, formerOwner]) {
      assert.equal((await removeTeammateForSession(sessionFor(staleOwner), { userId: coOwner.id })).ok, false);
      assert.equal((await changeTeammateRoleForSession(sessionFor(staleOwner), { userId: coOwner.id, role: "member" })).ok, false);
    }
    assert.deepEqual(await removeTeammate(founder.companyId, founder.id, coOwner.id), { removed: false });
    assert.equal(await setTeammateRole(founder.companyId, formerOwner.id, coOwner.id, "member"), false);
    // And the last owner can't step down or leave on their own.
    assert.equal((await changeTeammateRoleForSession(sessionFor(coOwner), { userId: coOwner.id, role: "member" })).ok, false);
    assert.equal((await removeTeammateForSession(sessionFor(coOwner), { userId: coOwner.id })).ok, false);
    assert.deepEqual(await personRow(coOwner.id), ACTIVE_OWNER);
  });

  await check("team: two owners removing or demoting each other at the same moment leave exactly one owner", async () => {
    const first = await signUpTestOwner("team-race-remove");
    const second = await addTeammate(first, "team-race-remove-2", "owner");
    const removals = await Promise.all([
      removeTeammate(first.companyId, first.id, second.id),
      removeTeammate(first.companyId, second.id, first.id),
    ]);
    assert.equal(removals.filter((removal) => removal.removed).length, 1);
    const stillOwners = [await personRow(first.id), await personRow(second.id)].filter((person) => person.removedAt === null);
    assert.deepEqual(stillOwners, [ACTIVE_OWNER]);

    const third = await signUpTestOwner("team-race-demote");
    const fourth = await addTeammate(third, "team-race-demote-2", "owner");
    const demotions = await Promise.all([
      setTeammateRole(third.companyId, third.id, fourth.id, "member"),
      setTeammateRole(third.companyId, fourth.id, third.id, "member"),
    ]);
    assert.equal(demotions.filter((changed) => changed).length, 1);
    const roles = [(await personRow(third.id)).role, (await personRow(fourth.id)).role].sort();
    assert.deepEqual(roles, ["member", "owner"]);
  });

  await check("team: an owner makes a member an owner and back, and it applies at their next click", async () => {
    const owner = await signUpTestOwner("team-roles");
    const member = await addTeammate(owner, "team-roles-member", "member");
    const browser = await logInBrowser(member.email, testPassword, "team-roles-member");
    assert.equal((await getSessionContextFromHeaders(browser))?.role, "member");
    assert.deepEqual(await changeTeammateRoleForSession(sessionFor(owner), { userId: member.id, role: "owner" }), { ok: true });
    assert.equal((await getSessionContextFromHeaders(browser))?.role, "owner");
    // Asking again for the role they already have changes nothing and is fine.
    assert.deepEqual(await changeTeammateRoleForSession(sessionFor(owner), { userId: member.id, role: "owner" }), { ok: true });
    assert.deepEqual(await changeTeammateRoleForSession(sessionFor(owner), { userId: member.id, role: "member" }), { ok: true });
    assert.equal((await getSessionContextFromHeaders(browser))?.role, "member");
  });

  await check("team: people who never confirmed keep their role, and junk input is refused", async () => {
    const owner = await signUpTestOwner("team-junk");
    const unconfirmed = await joinWithoutConfirming(owner, "team-junk-unconfirmed");
    const asOwner = sessionFor(owner);
    assert.equal((await changeTeammateRoleForSession(asOwner, { userId: unconfirmed.id, role: "owner" })).ok, false);
    assert.equal((await personRow(unconfirmed.id)).role, "member");
    const badRoleChanges = [{ userId: "", role: "owner" }, { userId: unconfirmed.id, role: "admin" }, { userId: ["x"], role: "owner" }, {}];
    for (const input of badRoleChanges) {
      assert.equal((await changeTeammateRoleForSession(asOwner, input)).ok, false, JSON.stringify(input));
    }
    for (const input of [{ userId: "" }, { userId: "x".repeat(101) }, { userId: 42 }, {}]) {
      assert.equal((await removeTeammateForSession(asOwner, input)).ok, false, JSON.stringify(input));
    }
    assert.deepEqual(await personRow(unconfirmed.id), { role: "member", removedAt: null, confirmed: false });
  });
}
