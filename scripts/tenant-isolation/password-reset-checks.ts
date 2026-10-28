// Password reset checks (step 22): asking always gets the same answer and
// sends nothing before the response, the link uses "#", only a hash of the
// token is stored, a link works once and ends every login, a reset or a
// password change voids the other links, bad links all get one answer, the
// emails are capped, and the inbox owner can take back an address someone
// else signed up. (Unconfirmed invitees: unconfirmed-invitee-checks.ts.)

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { verifications } from "@/db/schema";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { passwordResetTokenSchema } from "@/lib/validation/auth";
import { changePasswordForSession } from "@/services/account";
import { confirmEmailWithPassword } from "@/services/auth";
import {
  accountEmailFiles,
  accountState,
  allResetTokens,
  ignoreKnownDeviceCookie,
  isEmailNotVerifiedError,
  logInBrowser,
  newestVerificationToken,
  readOutboxFile,
  requestHeadersFrom,
  runAfterResponseTasks,
} from "./account-helpers";
import { captureConsole, check, runId, sessionFor, signUpTestOwner, testEmail, testPassword } from "./helpers";
import { askForReset, LINK_NOT_VALID, messageOf, resetTokenFor, resetWith } from "./reset-helpers";

const newPassword = `reset-new-password-${runId}`;

function logIn(email: string, password: string) {
  return auth.api.signInEmail({ body: { email, password } });
}

function isWrongPasswordError(error: unknown): boolean {
  return (error as { body?: { code?: string } } | null)?.body?.code === "INVALID_EMAIL_OR_PASSWORD";
}

export async function runPasswordResetChecks() {
  await check("reset: an address with an account and one without get the same answer; the email waits for after()", async () => {
    const owner = await signUpTestOwner("reset-known");
    const unknownEmail = testEmail("reset-unknown");
    const { result: asked, logs } = await captureConsole(async () => [
      await askForReset(owner.email, "reset-same-1"),
      await askForReset(unknownEmail, "reset-same-2"),
    ]);
    const [known, unknown] = asked;
    assert.deepEqual(known.result, { ok: true });
    assert.deepEqual(unknown.result, known.result, "the answers differ");
    assert.equal(unknown.afterResponse.length, 0, "an unknown address scheduled an email");
    assert.equal((await accountEmailFiles("reset-password", owner.id)).length, 0, "the email went out before the answer");
    await runAfterResponseTasks(known.afterResponse);
    assert.equal((await accountEmailFiles("reset-password", owner.id)).length, 1);
    assert.ok(logs.every((line) => !line.includes(owner.email) && !line.includes(unknownEmail)), "an address was logged");
  });

  await check("reset: the link carries the token after #, the email has no name, and only a hash of the token is stored", async () => {
    const owner = await signUpTestOwner("reset-link");
    const token = await resetTokenFor(owner.email, owner.id, "reset-link");
    const email = await readOutboxFile((await accountEmailFiles("reset-password", owner.id))[0]);
    assert.ok(email.includes(`${env.BETTER_AUTH_URL}/reset-password#${token}`));
    assert.ok(!email.includes("token=") && !email.includes("/api/auth"), "the token is in a query or path");
    assert.ok(!email.includes("Owner reset-link"), "the account's name is in the email");
    assert.ok(passwordResetTokenSchema.safeParse(token).success, "our shape check rejects a real token");
    const stored = await db.select().from(verifications).where(eq(verifications.value, owner.id));
    assert.equal(stored.length, 1);
    assert.ok(!stored[0].identifier.includes(token) && !stored[0].identifier.startsWith("reset-password:"), "the token is stored in plain text");
  });

  await check("reset: a link works once, ends every login, and only the new password works afterwards", async () => {
    const owner = await signUpTestOwner("reset-once");
    await logIn(owner.email, testPassword);
    await logIn(owner.email, testPassword);
    assert.equal((await accountState(owner.id)).sessions, 2);
    const token = await resetTokenFor(owner.email, owner.id, "reset-once");
    const { result, logs } = await captureConsole(() => resetWith(token, newPassword, "reset-once"));
    assert.deepEqual(result, { ok: true, outcome: "password-changed" }, messageOf(result));
    assert.ok(logs.every((line) => !line.includes(token) && !line.includes(owner.email)), "the token or address was logged");
    assert.equal((await accountState(owner.id)).sessions, 0, "old logins survived the reset");
    await assert.rejects(logIn(owner.email, testPassword));
    await logIn(owner.email, newPassword);
    // The same link again: refused, and the password stays the new one.
    assert.match(messageOf(await resetWith(token, `another-password-${runId}`, "reset-once-again")), LINK_NOT_VALID);
    await logIn(owner.email, newPassword);
  });

  await check("reset: expired, unknown and malformed links all get one answer and change nothing", async () => {
    const owner = await signUpTestOwner("reset-bad");
    const token = await resetTokenFor(owner.email, owner.id, "reset-bad");
    await db.update(verifications).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(verifications.value, owner.id));
    for (const badToken of [token, "A".repeat(24), token.slice(0, 23), `${token}x`, "../../reset", ""]) {
      assert.match(messageOf(await resetWith(badToken, newPassword, "reset-bad")), LINK_NOT_VALID, `"${badToken}"`);
    }
    await logIn(owner.email, testPassword);
    // A good-looking link with a too-short password: the password is what's wrong.
    const tooShort = await resetWith("A".repeat(24), "short", "reset-bad-short");
    assert.ok(!tooShort.ok && tooShort.errors.fieldErrors?.newPassword, "a short password was not flagged");
  });

  await check("reset: at most 3 reset emails per address per hour, skipped silently; one IP asking too often is refused", async () => {
    const owner = await signUpTestOwner("reset-cap");
    for (let attempt = 0; attempt < 5; attempt++) {
      const { result, afterResponse } = await askForReset(owner.email, `reset-cap-${attempt}`);
      assert.deepEqual(result, { ok: true });
      await runAfterResponseTasks(afterResponse);
    }
    assert.equal((await accountEmailFiles("reset-password", owner.id)).length, 3);
    // Better Auth warns once per unknown address; captured to keep the output short.
    await captureConsole(async () => {
      for (let attempt = 0; attempt < 20; attempt++) {
        assert.deepEqual((await askForReset(testEmail(`reset-ip-${attempt}`), "reset-one-ip")).result, { ok: true });
      }
    });
    assert.match(messageOf((await askForReset(testEmail("reset-ip-last"), "reset-one-ip")).result), /Too many requests/);
  });

  await check("reset: a reset asked for outside services/password-reset.ts sends nothing", async () => {
    const owner = await signUpTestOwner("reset-outside");
    const { logs } = await captureConsole(() => auth.api.requestPasswordReset({ body: { email: owner.email } }));
    assert.equal((await accountEmailFiles("reset-password", owner.id)).length, 0);
    assert.ok(logs.some((line) => line.includes("Password reset email skipped")));
  });

  await check("reset: the inbox owner takes back an address someone else signed up: new password, then link plus password", async () => {
    const address = testEmail("reset-squatted");
    const squatterPassword = `squatter-password-${runId}`;
    const squatterBody = { name: "Squatter", email: address, password: squatterPassword, companyName: `Isolation test reset squatter ${runId}` };
    const userId = (await auth.api.signUpEmail({ body: squatterBody })).user.id;
    // The real owner of the inbox asks for a link and chooses a password. The
    // account is kept: its company is its own (nobody else could join it).
    const token = await resetTokenFor(address, userId, "reset-squatted");
    assert.deepEqual(await resetWith(token, newPassword, "reset-squatted"), { ok: true, outcome: "password-changed" });
    // Still unconfirmed: the reset alone logs nobody in and confirms nothing.
    assert.deepEqual(await accountState(userId), { email: address, verified: false, sessions: 0 });
    await assert.rejects(logIn(address, squatterPassword), isWrongPasswordError, "the squatter's password still works");
    // Logging in with the new password mails a fresh link; the link plus that password confirm it.
    await assert.rejects(logIn(address, newPassword), isEmailNotVerifiedError);
    const confirmed = await confirmEmailWithPassword(
      { token: await newestVerificationToken(userId), password: newPassword },
      requestHeadersFrom("reset-squatted-confirm"),
      ignoreKnownDeviceCookie,
    );
    assert.equal(confirmed.ok, true, messageOf(confirmed));
    assert.deepEqual(await accountState(userId), { email: address, verified: true, sessions: 1 });
  });

  await check("reset: using one link voids the account's other links", async () => {
    const owner = await signUpTestOwner("reset-two-links");
    await resetTokenFor(owner.email, owner.id, "reset-two-links-1");
    await resetTokenFor(owner.email, owner.id, "reset-two-links-2");
    const [firstLink, secondLink] = await allResetTokens(owner.id);
    assert.equal((await resetWith(secondLink, newPassword, "reset-two-links-use")).ok, true);
    assert.match(messageOf(await resetWith(firstLink, `another-password-${runId}`, "reset-two-links-old")), LINK_NOT_VALID);
    await logIn(owner.email, newPassword);
  });

  await check("reset: changing the password on the Account page voids links sent before", async () => {
    const owner = await signUpTestOwner("reset-then-change");
    const pendingLink = await resetTokenFor(owner.email, owner.id, "reset-then-change");
    const browser = await logInBrowser(owner.email, testPassword, "reset-then-change-browser");
    const changed = await changePasswordForSession(sessionFor(owner), { currentPassword: testPassword, newPassword }, browser);
    assert.equal(changed.ok, true, messageOf(changed));
    assert.match(messageOf(await resetWith(pendingLink, `another-password-${runId}`, "reset-then-change-old")), LINK_NOT_VALID);
    await logIn(owner.email, newPassword);
  });
}
