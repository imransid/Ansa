// Unconfirmed invitee checks (step 22): an owner who invites someone else's
// address and joins with it (or a mistyped invite) holds the address only
// until its inbox owner uses a reset link. The link then removes the account
// instead of setting a password, so the inbox owner never lands in that team,
// the account's open tickets are routed again, and the address is free. An
// invitee who confirmed first keeps the account, and the removal never
// reaches another company or a confirmed account.

import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { hasAcceptedInviteFor } from "@/db/invites";
import { accounts, tickets, userCategories, users, verifications } from "@/db/schema";
import { removeUnconfirmedAccount } from "@/db/unconfirmed-accounts";
import { getUsersInCompany } from "@/db/users";
import { confirmEmailWithPassword } from "@/services/auth";
import { createCategoryForSession, getTeamCategoriesForSession, setUserCategoriesForSession } from "@/services/categories";
import { joinCompanyWithInvite, signUpCompanyOwner } from "@/services/signup";
import { createTicketForCompany } from "@/services/tickets";
import {
  ignoreKnownDeviceCookie,
  newestVerificationToken,
  requestHeadersFrom,
  userIdsWithEmail,
} from "./account-helpers";
import {
  addTeammate,
  captureConsole,
  check,
  inviteAs,
  runId,
  sessionFor,
  signUpTestOwner,
  testEmail,
  unconfirmedAccountIds,
  type TestUser,
} from "./helpers";
import { LINK_NOT_VALID, messageOf, resetTokenFor, resetWith } from "./reset-helpers";

const joinPassword = `invitee-join-password-${runId}`;
const inboxOwnerPassword = `inbox-owner-password-${runId}`;

// Joins `owner`'s company through a real invite for `email`, the way the join
// form does, and returns the new (unconfirmed) account's id.
async function joinAsInvitee(owner: TestUser, email: string, clientLabel: string): Promise<string> {
  const inviteToken = await inviteAs(owner, email, "member");
  const joinInput = { inviteToken, name: "Invitee", email, password: joinPassword };
  assert.deepEqual(await joinCompanyWithInvite(joinInput, requestHeadersFrom(clientLabel)), { ok: true });
  const [userId] = await userIdsWithEmail(email);
  unconfirmedAccountIds.push(userId);
  return userId;
}

async function assignmentEmailCount(ticketId: string): Promise<number> {
  const outbox = await readdir(path.join(process.cwd(), ".dev-emails")).catch(() => [] as string[]);
  return outbox.filter((file) => file.includes(`ticket-assigned-${ticketId}-`)).length;
}

async function storedTicket(ticketId: string) {
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
  return ticket;
}

export async function runUnconfirmedInviteeChecks() {
  await check("reset: an address an owner joined with through their own invite is freed by its inbox owner's reset link", async () => {
    const squatter = await signUpTestOwner("invitee-squatter");
    const expert = await addTeammate(squatter, "invitee-expert", "member");
    const asSquatter = sessionFor(squatter);
    await createCategoryForSession(asSquatter, { name: "Invitee check" });
    const { categories } = await getTeamCategoriesForSession(asSquatter);
    const categoryId = categories.find((category) => category.name === "Invitee check")!.id;
    // 1. The owner invites someone else's address and joins with it, with a password only they know.
    const victimAddress = testEmail("invitee-victim");
    const squattedId = await joinAsInvitee(squatter, victimAddress, "invitee-squat-join");
    // 2. The account holds work. Since step 23 nobody unconfirmed gets
    // categories or tickets, so this is set straight in the database, as an
    // account from before that would hold it.
    assert.equal((await setUserCategoriesForSession(asSquatter, { userId: squattedId, categoryIds: [categoryId] })).ok, false);
    await db.insert(userCategories).values({ companyId: squatter.companyId, userId: squattedId, categoryId });
    const ticket = await createTicketForCompany(squatter.companyId, { subject: "Invitee check", description: "x", channel: "phone", category: "Invitee check" });
    assert.equal(ticket.assignedToUserId, null, "routing gave a ticket to an unconfirmed account");
    await db
      .update(tickets)
      .set({ assignedToUserId: squattedId, assignedAutomatically: true, routedToUserId: squattedId })
      .where(eq(tickets.id, ticket.id));
    await setUserCategoriesForSession(asSquatter, { userId: expert.id, categoryIds: [categoryId] });
    // 3. The real owner of the inbox gets a reset link and uses it.
    const resetLink = await resetTokenFor(victimAddress, squattedId, "invitee-victim-asks");
    const { result } = await captureConsole(() => resetWith(resetLink, inboxOwnerPassword, "invitee-victim-resets"));
    assert.deepEqual(result, { ok: true, outcome: "account-removed" }, messageOf(result));
    // The account is gone from the team, with its login and links; nobody got in.
    assert.deepEqual(await userIdsWithEmail(victimAddress), []);
    assert.ok(!(await getUsersInCompany(squatter.companyId)).some((person) => person.email === victimAddress));
    assert.equal((await db.select().from(accounts).where(eq(accounts.userId, squattedId))).length, 0);
    assert.equal((await db.select().from(verifications).where(eq(verifications.value, squattedId))).length, 0);
    assert.match(messageOf(await resetWith(resetLink, inboxOwnerPassword, "invitee-victim-again")), LINK_NOT_VALID);
    // Its open ticket was routed again, and the new assignee was told.
    const rerouted = await storedTicket(ticket.id);
    assert.deepEqual(
      [rerouted.assignedToUserId, rerouted.assignedAutomatically, rerouted.routedToUserId],
      [expert.id, true, expert.id],
    );
    assert.equal(await assignmentEmailCount(ticket.id), 1, "the new assignee wasn't emailed");
    // 4. The address is free: its owner signs up with it, in a company of their own.
    const victimCompanyName = `Isolation test invitee victim ${runId}`;
    const signupInput = { companyName: victimCompanyName, name: "Victim", email: victimAddress, password: inboxOwnerPassword };
    assert.deepEqual(await signUpCompanyOwner(signupInput, requestHeadersFrom("invitee-victim-signup")), { ok: true });
    const [victim] = await db.select({ companyId: users.companyId }).from(users).where(eq(users.email, victimAddress));
    assert.notEqual(victim.companyId, squatter.companyId);
  });

  await check("reset: an invitee who confirms before using the link keeps the account and the team", async () => {
    const owner = await signUpTestOwner("invitee-confirms");
    const address = testEmail("invitee-confirmer");
    const inviteeId = await joinAsInvitee(owner, address, "invitee-confirms-join");
    const resetLink = await resetTokenFor(address, inviteeId, "invitee-confirms-asks");
    const confirmed = await confirmEmailWithPassword(
      { token: await newestVerificationToken(inviteeId), password: joinPassword },
      requestHeadersFrom("invitee-confirms-confirm"),
      ignoreKnownDeviceCookie,
    );
    assert.equal(confirmed.ok, true, messageOf(confirmed));
    const reset = await resetWith(resetLink, inboxOwnerPassword, "invitee-confirms-resets");
    assert.deepEqual(reset, { ok: true, outcome: "password-changed" }, messageOf(reset));
    assert.ok((await getUsersInCompany(owner.companyId)).some((person) => person.id === inviteeId), "the teammate was removed");
  });

  await check("reset: removing an unconfirmed invitee stays inside its company and never touches a confirmed account", async () => {
    const owner = await signUpTestOwner("invitee-scope");
    const otherCompany = await signUpTestOwner("invitee-scope-other");
    const address = testEmail("invitee-scoped");
    const inviteeId = await joinAsInvitee(owner, address, "invitee-scope-join");
    // The invite rule reads only the account's own company's invites.
    assert.deepEqual(
      [await hasAcceptedInviteFor(owner.companyId, address), await hasAcceptedInviteFor(otherCompany.companyId, address)],
      [true, false],
    );
    assert.deepEqual(await removeUnconfirmedAccount(otherCompany.companyId, inviteeId), { removed: false });
    assert.deepEqual(await removeUnconfirmedAccount(owner.companyId, owner.id), { removed: false }, "a confirmed account was removed");
    assert.deepEqual(await userIdsWithEmail(address), [inviteeId]);
    assert.ok((await getUsersInCompany(owner.companyId)).some((person) => person.id === owner.id));
  });
}
