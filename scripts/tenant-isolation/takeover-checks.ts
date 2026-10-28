// Signup takeover checks (step 21): signing up someone else's address first
// never gets anyone into their account, a repeat signup changes nothing and
// only emails the address, and the join form answers an address that has an
// account exactly like a new one.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { getPendingInvitesForCompany } from "@/db/invites";
import { companies } from "@/db/schema";
import { getUsersInCompany } from "@/db/users";
import { auth } from "@/lib/auth";
import { generateInviteToken } from "@/lib/invite-token";
import { confirmEmailWithPassword } from "@/services/auth";
import { getInvitePreview } from "@/services/invites";
import { joinCompanyWithInvite, signUpCompanyOwner } from "@/services/signup";
import {
  accountEmailFiles,
  accountState,
  ignoreKnownDeviceCookie,
  isEmailNotVerifiedError,
  newestVerificationToken,
  readOutboxFile,
  requestHeadersFrom,
  userIdsWithEmail,
} from "./account-helpers";
import { captureConsole, check, inviteAs, runId, signUpTestOwner, testEmail } from "./helpers";

const squatterPassword = `squatter-password-${runId}`;
const realOwnerPassword = `real-owner-password-${runId}`;

async function companiesNamed(name: string): Promise<number> {
  return (await db.select({ id: companies.id }).from(companies).where(eq(companies.name, name))).length;
}

// What the /verify-email form does: the token from the link plus a password.
function confirmFrom(token: string, password: string, clientLabel: string) {
  return confirmEmailWithPassword({ token, password }, requestHeadersFrom(clientLabel), ignoreKnownDeviceCookie);
}

function signUpThroughForm(email: string, password: string, companyName: string, clientLabel: string) {
  return signUpCompanyOwner({ companyName, name: "Someone", email, password }, requestHeadersFrom(clientLabel));
}

export async function runTakeoverChecks() {
  await check("takeover: whoever signs up someone's address first can't get in through the real owner's click", async () => {
    const address = testEmail("squatted");
    // 1. The squatter signs the address up first, with a password only they know.
    const squatterBody = { name: "Squatter", email: address, password: squatterPassword, companyName: `Isolation test squatter ${runId}` };
    const squatterId = (await auth.api.signUpEmail({ body: squatterBody })).user.id;
    // 2. The real owner signs up later: the same answer as a new signup, but nothing is created.
    const realOwnerCompany = `Isolation test real owner ${runId}`;
    assert.deepEqual(await signUpThroughForm(address, realOwnerPassword, realOwnerCompany, "squat-signup"), { ok: true });
    assert.deepEqual(await userIdsWithEmail(address), [squatterId]);
    assert.equal(await companiesNamed(realOwnerCompany), 0);
    assert.equal((await accountEmailFiles("existing-account", squatterId)).length, 1, "the address wasn't told");
    assert.equal((await accountEmailFiles("verify-email", squatterId)).length, 1, "the repeat signup sent a link");
    // 3. The squatter logs in, which mails the real owner a genuine link.
    await assert.rejects(auth.api.signInEmail({ body: { email: address, password: squatterPassword } }), isEmailNotVerifiedError);
    const link = await newestVerificationToken(squatterId);
    // 4. The real owner opens it and types their own password: refused, nothing changes.
    const ownersTry = await confirmFrom(link, realOwnerPassword, "squat-click");
    assert.equal(ownersTry.ok, false);
    assert.deepEqual(await accountState(squatterId), { email: address, verified: false, sessions: 0 });
    // 5. So the squatter still can't log in.
    await assert.rejects(auth.api.signInEmail({ body: { email: address, password: squatterPassword } }), isEmailNotVerifiedError);
    // 6. Only the link together with the password that signed up confirms it
    //    (the normal flow, where one person did both).
    const together = await confirmFrom(link, squatterPassword, "squat-both");
    assert.equal(together.ok, true);
    assert.deepEqual(await accountState(squatterId), { email: address, verified: true, sessions: 1 });
  });

  await check("takeover: whoever owns a mistyped invite address can't get into the team with the link", async () => {
    const owner = await signUpTestOwner("typo-inviter");
    const mistyped = testEmail("typo-invitee");
    const inviteToken = await inviteAs(owner, mistyped, "member");
    const joinInput = { inviteToken, name: "Teammate", email: mistyped, password: realOwnerPassword };
    assert.deepEqual(await joinCompanyWithInvite(joinInput, requestHeadersFrom("typo-join")), { ok: true });
    const [inviteeId] = await userIdsWithEmail(mistyped);
    // The stranger who owns that inbox gets the link, but not the teammate's password.
    const strangersTry = await confirmFrom(await newestVerificationToken(inviteeId), "a-strangers-best-guess", "typo-stranger");
    assert.equal(strangersTry.ok, false);
    assert.deepEqual(await accountState(inviteeId), { email: mistyped, verified: false, sessions: 0 });
  });

  await check("repeat signup: changes nothing, logs nothing and sends one 'you already have an account' email", async () => {
    const address = testEmail("signed-up-twice");
    const secondCompany = `Isolation test second try ${runId}`;
    const first = await signUpThroughForm(address, realOwnerPassword, `Isolation test first try ${runId}`, "twice-1");
    // Better Auth logs this address on a repeat signup at "info" level, which
    // lib/auth.ts keeps switched off.
    const { result: second, logs } = await captureConsole(() =>
      signUpThroughForm(address, `another-password-${runId}`, secondCompany, "twice-2"),
    );
    assert.deepEqual([first, second], [{ ok: true }, { ok: true }], "the form told the two signups apart");
    assert.ok(logs.every((line) => !line.includes(address)), "the address was logged");
    const [userId] = await userIdsWithEmail(address);
    assert.equal(await companiesNamed(secondCompany), 0);
    assert.equal((await accountEmailFiles("verify-email", userId)).length, 1, "the repeat signup sent a link");
    const notices = await accountEmailFiles("existing-account", userId);
    assert.equal(notices.length, 1);
    const notice = await readOutboxFile(notices[0]);
    assert.ok(notice.includes("/login") && notice.includes("One email address can belong to one company only"));
    // Better Auth kept the first password: the second one is simply wrong.
    await assert.rejects(
      auth.api.signInEmail({ body: { email: address, password: `another-password-${runId}` } }),
      (error: unknown) => (error as { body?: { code?: string } }).body?.code === "INVALID_EMAIL_OR_PASSWORD",
    );
  });

  await check("repeat signup: at most 3 'you already have an account' emails per address per hour", async () => {
    const existing = await signUpTestOwner("existing-cap");
    for (let attempt = 0; attempt < 5; attempt++) {
      await signUpThroughForm(existing.email, realOwnerPassword, `Isolation test again ${runId}`, `existing-cap-${attempt}`);
    }
    assert.equal((await accountEmailFiles("existing-account", existing.id)).length, 3);
  });

  await check("join: an invite for an address that has an account answers like a new signup; the invite stays pending", async () => {
    const inviter = await signUpTestOwner("existing-inviter");
    const elsewhere = await signUpTestOwner("existing-elsewhere");
    const inviteToken = await inviteAs(inviter, elsewhere.email, "member");
    const joinInput = { inviteToken, name: "Elsewhere", email: elsewhere.email, password: realOwnerPassword };
    assert.deepEqual(await joinCompanyWithInvite(joinInput, requestHeadersFrom("existing-join")), { ok: true });
    assert.deepEqual((await getUsersInCompany(elsewhere.companyId)).map((user) => user.id), [elsewhere.id]);
    assert.deepEqual((await getUsersInCompany(inviter.companyId)).map((user) => user.id), [inviter.id]);
    assert.deepEqual((await getPendingInvitesForCompany(inviter.companyId)).map((invite) => invite.email), [elsewhere.email]);
    assert.equal((await accountEmailFiles("existing-account", elsewhere.id)).length, 1);
  });

  await check("join: a made-up invite gets the same answer for an address with an account as for a new one", async () => {
    const existing = await signUpTestOwner("junk-invite-existing");
    const tryJoin = (email: string, clientLabel: string) =>
      joinCompanyWithInvite(
        { inviteToken: generateInviteToken(), name: "Prober", email, password: realOwnerPassword },
        requestHeadersFrom(clientLabel),
      );
    const forExisting = await tryJoin(existing.email, "junk-1");
    const forNew = await tryJoin(testEmail("junk-invite-new"), "junk-2");
    assert.equal(forExisting.ok, false);
    assert.deepEqual(forExisting, forNew);
    assert.equal((await accountEmailFiles("existing-account", existing.id)).length, 0, "a made-up invite reached Better Auth");
  });

  await check("invite preview: rate limiting is reported as rate limiting, not as a dead invite", async () => {
    const owner = await signUpTestOwner("preview-limit");
    const inviteToken = await inviteAs(owner, testEmail("preview-limit-invitee"), "member");
    const sameClient = requestHeadersFrom("preview-limit");
    assert.equal((await getInvitePreview(inviteToken, sameClient)).status, "ready");
    for (let attempt = 1; attempt < 30; attempt++) {
      await getInvitePreview(inviteToken, sameClient);
    }
    assert.equal((await getInvitePreview(inviteToken, sameClient)).status, "rate-limited");
    assert.equal((await getInvitePreview(generateInviteToken(), requestHeadersFrom("preview-other"))).status, "not-usable");
  });
}
