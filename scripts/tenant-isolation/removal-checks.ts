// Removal checks (step 23): removing a teammate logs them out everywhere at
// once and refuses their logins and reset links; their open tickets go back
// to routing (the new assignee is emailed) and their invites are revoked,
// while old tickets keep their name. Someone who never confirmed is deleted
// instead, which frees their address.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { getPendingInvitesForCompany } from "@/db/invites";
import { accounts } from "@/db/schema";
import { updateUserName } from "@/db/users";
import { auth } from "@/lib/auth";
import { getSessionContextFromHeaders } from "@/lib/session-context";
import { confirmEmailWithPassword, logIn } from "@/services/auth";
import { getTeamCategoriesForSession, setUserCategoriesForSession } from "@/services/categories";
import { createInviteForSession } from "@/services/invites";
import { getSetupForSession } from "@/services/setup";
import { getTeamForSession, removeTeammateForSession } from "@/services/team";
import { markTicketSolvedForSession } from "@/services/ticket-status";
import { assignTicketForSession, createTicketForCompany, getTicketForSession } from "@/services/tickets";
import {
  accountEmailFiles,
  ignoreKnownDeviceCookie,
  isLoggedIn,
  logInBrowser,
  newestVerificationToken,
  requestHeadersFrom,
  runAfterResponseTasks,
  sessionIdsOf,
  userIdsWithEmail,
} from "./account-helpers";
import { addTeammate, captureConsole, check, inviteAs, sessionFor, signUpTestOwner, testEmail, testPassword } from "./helpers";
import { askForReset, LINK_NOT_VALID, messageOf, resetTokenFor, resetWith } from "./reset-helpers";
import {
  addCategory,
  assignmentEmailCount,
  joinWithoutConfirming,
  markRemovedInDatabaseOnly,
  newTicket,
  storedTicket,
} from "./team-helpers";

async function passwordHashOf(userId: string): Promise<string | null> {
  const [credential] = await db.select({ password: accounts.password }).from(accounts).where(eq(accounts.userId, userId));
  return credential?.password ?? null;
}

export async function runRemovalChecks() {
  await check("removal: their sessions end at once, their login fails, and their address stays taken", async () => {
    const owner = await signUpTestOwner("removal-access");
    const member = await addTeammate(owner, "removal-access-member", "member");
    const laptop = await logInBrowser(member.email, testPassword, "removal-access-laptop");
    const phone = await logInBrowser(member.email, testPassword, "removal-access-phone");
    assert.ok(await getSessionContextFromHeaders(laptop));
    assert.deepEqual(await removeTeammateForSession(sessionFor(owner), { userId: member.id }), { ok: true });
    assert.deepEqual([await isLoggedIn(laptop), await isLoggedIn(phone)], [false, false]);
    assert.equal(await getSessionContextFromHeaders(laptop), null);
    // The right password now gets the same answer as a wrong one, and no session.
    const { result: login } = await captureConsole(() =>
      logIn({ email: member.email, password: testPassword }, requestHeadersFrom("removal-access-login"), ignoreKnownDeviceCookie),
    );
    assert.match(messageOf(login), /Email or password is incorrect/);
    assert.deepEqual(await sessionIdsOf(member.id), []);
    assert.equal(await passwordHashOf(member.id), null, "a removed person's password hash was kept");
    const reinvite = await createInviteForSession(sessionFor(owner), { email: member.email, role: "member" });
    assert.equal(reinvite.ok, false, "a removed person's address can't be invited again");
  });

  await check("removal: a session that outlived the removal counts as logged out, and Better Auth opens no new one", async () => {
    const owner = await signUpTestOwner("removal-leftover");
    const member = await addTeammate(owner, "removal-leftover-member", "member");
    const browser = await logInBrowser(member.email, testPassword, "removal-leftover");
    await markRemovedInDatabaseOnly(member.id);
    assert.equal(await isLoggedIn(browser), true, "this check needs the session row to survive");
    assert.equal(await getSessionContextFromHeaders(browser), null);
    // Straight to Better Auth, past our services: the session hook in lib/auth.ts refuses.
    const { result: refusedCode } = await captureConsole(() =>
      auth.api.signInEmail({ body: { email: member.email, password: testPassword } }).then(
        () => "a session was opened",
        (error: { body?: { code?: string } }) => error.body?.code,
      ),
    );
    assert.equal(refusedCode, "FAILED_TO_CREATE_SESSION");
    assert.equal((await sessionIdsOf(member.id)).length, 1);
  });

  await check("removal: the confirm page can't log a removed account in either", async () => {
    // The app deletes unconfirmed accounts instead of removing them; this one
    // is marked removed straight in the database to test the hook on that path.
    const owner = await signUpTestOwner("removal-confirm");
    const unconfirmed = await joinWithoutConfirming(owner, "removal-confirm-joiner");
    await markRemovedInDatabaseOnly(unconfirmed.id);
    const { result } = await captureConsole(async () =>
      confirmEmailWithPassword(
        { token: await newestVerificationToken(unconfirmed.id), password: testPassword },
        requestHeadersFrom("removal-confirm"),
        ignoreKnownDeviceCookie,
      ),
    );
    assert.equal(result.ok, false);
    assert.deepEqual(await sessionIdsOf(unconfirmed.id), []);
  });

  await check("removal: a removed person gets no reset link, and links sent before stop working", async () => {
    const owner = await signUpTestOwner("removal-reset");
    const member = await addTeammate(owner, "removal-reset-member", "member");
    const earlierLink = await resetTokenFor(member.email, member.id, "removal-reset-before");
    assert.deepEqual(await removeTeammateForSession(sessionFor(owner), { userId: member.id }), { ok: true });
    assert.match(messageOf(await resetWith(earlierLink, "a-brand-new-password-1", "removal-reset-use")), LINK_NOT_VALID);
    const emailsBefore = (await accountEmailFiles("reset-password", member.id)).length;
    const { result, afterResponse } = await askForReset(member.email, "removal-reset-after");
    assert.deepEqual(result, { ok: true }, "the form must answer as it does for anyone");
    await runAfterResponseTasks(afterResponse);
    assert.equal((await accountEmailFiles("reset-password", member.id)).length, emailsBefore, "a reset email was sent");
    // A link that slipped out at the very moment of a removal sets no password.
    const other = await addTeammate(owner, "removal-reset-other", "member");
    const raceLink = await resetTokenFor(other.email, other.id, "removal-reset-race");
    const hashBefore = await passwordHashOf(other.id);
    await markRemovedInDatabaseOnly(other.id);
    assert.match(messageOf(await resetWith(raceLink, "a-brand-new-password-2", "removal-reset-race-use")), LINK_NOT_VALID);
    assert.equal(await passwordHashOf(other.id), hashBefore);
  });

  await check("removal: open tickets go back to routing (assignee emailed), old tickets keep the name, invites are revoked", async () => {
    const owner = await signUpTestOwner("removal-tickets");
    const asOwner = sessionFor(owner);
    // An owner, so they can have invites of their own.
    const leaver = await addTeammate(owner, "removal-leaver", "owner");
    const stayer = await addTeammate(owner, "removal-stayer", "member");
    await updateUserName(owner.companyId, leaver.id, "Leaver Lima");
    const categoryId = await addCategory(owner, "Removal check");
    for (const person of [leaver, stayer]) {
      await setUserCategoriesForSession(asOwner, { userId: person.id, categoryIds: [categoryId] });
    }
    // Routing: leaver (joined first), stayer, then leaver again on the tie.
    const routedToLeaver = await createTicketForCompany(owner.companyId, newTicket("Removal check"));
    const routedToStayer = await createTicketForCompany(owner.companyId, newTicket("Removal check"));
    const solvedByLeaver = await createTicketForCompany(owner.companyId, newTicket("Removal check"));
    assert.deepEqual(
      [routedToLeaver.assignedToUserId, routedToStayer.assignedToUserId, solvedByLeaver.assignedToUserId],
      [leaver.id, stayer.id, leaver.id],
    );
    assert.deepEqual(await markTicketSolvedForSession(sessionFor(leaver), { ticketId: solvedByLeaver.id, confirmedCustomerEmail: "" }), { ok: true });
    const noCategory = await createTicketForCompany(owner.companyId, newTicket());
    assert.deepEqual(await assignTicketForSession(asOwner, { ticketId: noCategory.id, assigneeUserId: leaver.id }), { ok: true });
    const invitedByLeaver = testEmail("removal-leavers-invitee");
    await inviteAs(leaver, invitedByLeaver, "member");
    const emailsBefore = await assignmentEmailCount(routedToLeaver.id);

    assert.deepEqual(await removeTeammateForSession(asOwner, { userId: leaver.id }), { ok: true });

    // Routed again to the stayer, who is told; routing's first pick stays recorded.
    const rerouted = await storedTicket(routedToLeaver.id);
    assert.deepEqual([rerouted.assignedToUserId, rerouted.assignedAutomatically, rerouted.routedToUserId], [stayer.id, true, leaver.id]);
    assert.equal(await assignmentEmailCount(routedToLeaver.id), emailsBefore + 1);
    // No category, nobody to route it to: it waits, unassigned.
    const waiting = await storedTicket(noCategory.id);
    assert.deepEqual([waiting.assignedToUserId, waiting.assignedAutomatically], [null, null]);
    // The solved ticket still shows who worked on it.
    const history = await getTicketForSession(asOwner, solvedByLeaver.ticketNumber);
    assert.deepEqual([history?.status, history?.assigneeName, history?.solvedByName], ["solved", "Leaver Lima", "Leaver Lima"]);
    // Their categories and pending invites are gone; the Team page lists them apart.
    assert.deepEqual((await getTeamCategoriesForSession(asOwner)).links.filter((link) => link.userId === leaver.id), []);
    assert.ok(!(await getPendingInvitesForCompany(owner.companyId)).some((invite) => invite.email === invitedByLeaver));
    const team = await getTeamForSession(asOwner);
    assert.ok(!team.members.some((person) => person.id === leaver.id));
    assert.deepEqual(team.removedMembers.map((person) => person.name), ["Leaver Lima"]);
    assert.equal((await getSetupForSession(asOwner)).memberCount, 2);
    // New tickets in their category skip them.
    assert.equal((await createTicketForCompany(owner.companyId, newTicket("Removal check"))).assignedToUserId, stayer.id);
  });

  await check("removal: someone who never confirmed is deleted, which frees the address for a new invite", async () => {
    const owner = await signUpTestOwner("removal-unconfirmed");
    const unconfirmed = await joinWithoutConfirming(owner, "removal-unconfirmed-joiner");
    assert.deepEqual(await removeTeammateForSession(sessionFor(owner), { userId: unconfirmed.id }), { ok: true });
    assert.deepEqual(await userIdsWithEmail(unconfirmed.email), []);
    const team = await getTeamForSession(sessionFor(owner));
    assert.deepEqual([...team.members, ...team.removedMembers].map((person) => person.id), [owner.id]);
    assert.equal((await createInviteForSession(sessionFor(owner), { email: unconfirmed.email, role: "member" })).ok, true);
  });
}
