// Email verification checks (steps 12 and 21): signup gives no session and
// sends a link with the token after "#", login is refused until confirmed,
// only the link AND the account's password confirm the address and log in,
// bad links never work, the emails are capped, and nothing is logged.
// (Better Auth's own HTTP routes are checked in auth-handler-checks.ts.)

import assert from "node:assert/strict";
import { createEmailVerificationToken } from "better-auth/api";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import type { FormResult } from "@/lib/form-result";
import { verificationTokenSchema } from "@/lib/validation/auth";
import { confirmEmailWithPassword, logIn } from "@/services/auth";
import {
  accountEmailFiles,
  accountState,
  ignoreKnownDeviceCookie,
  isEmailNotVerifiedError,
  newestVerificationToken,
  readOutboxFile,
  requestHeadersFrom,
} from "./account-helpers";
import { captureConsole, check, runId, testEmail, testPassword } from "./helpers";

const WRONG_LINK_OR_PASSWORD = /This link has expired or the password is wrong/;
const TOO_MANY_ATTEMPTS = /Too many attempts/;

async function signUpUnverified(label: string, name = `Verify ${label}`) {
  const email = testEmail(label);
  const body = { name, email, password: testPassword, companyName: `Isolation test ${label} ${runId}` };
  const result = await auth.api.signUpEmail({ body });
  return { email, userId: result.user.id, sessionToken: result.token };
}

// What the /verify-email form does: the token from the link plus a password.
function confirm(token: string, password: string, clientLabel: string): Promise<FormResult> {
  return confirmEmailWithPassword({ token, password }, requestHeadersFrom(clientLabel), ignoreKnownDeviceCookie);
}

function messageOf(result: FormResult): string {
  return result.ok ? "(it worked)" : (result.errors.message ?? "(no message)");
}

export async function runVerificationChecks() {
  await check("verification: signup gives no session and emails a link with the token after #", async () => {
    const { result, logs } = await captureConsole(() => signUpUnverified("verify-new"));
    assert.equal(result.sessionToken, null, "signup returned a session");
    assert.deepEqual(await accountState(result.userId), { email: result.email, verified: false, sessions: 0 });
    const files = await accountEmailFiles("verify-email", result.userId);
    assert.equal(files.length, 1, "no verification email was written");
    const email = await readOutboxFile(files[0]);
    assert.ok(email.includes(`${env.BETTER_AUTH_URL}/verify-email#`));
    assert.ok(!email.includes("token="), "the token is in a query string");
    assert.ok(logs.every((line) => !line.includes(result.email)), "the address was logged");
  });

  await check("verification: the email never repeats the name typed at signup", async () => {
    const typedName = `Your account is locked, call +1 555 0100 ${runId}`;
    const { userId } = await signUpUnverified("verify-name", typedName);
    const email = await readOutboxFile((await accountEmailFiles("verify-email", userId))[0]);
    assert.ok(!email.includes(typedName), "the typed name is in the email");
    assert.ok(email.includes("Hello,"));
  });

  await check("verification: login is refused until confirmed, and sends a fresh link", async () => {
    const { email, userId } = await signUpUnverified("verify-login");
    await assert.rejects(auth.api.signInEmail({ body: { email, password: testPassword } }), isEmailNotVerifiedError);
    assert.equal((await accountEmailFiles("verify-email", userId)).length, 2, "no fresh link on login");
  });

  await check("verification: at most 3 verification emails per address per hour, skipped silently", async () => {
    const { email, userId } = await signUpUnverified("verify-cap");
    for (let attempt = 0; attempt < 4; attempt++) {
      await assert.rejects(auth.api.signInEmail({ body: { email, password: testPassword } }), isEmailNotVerifiedError);
    }
    assert.equal((await accountEmailFiles("verify-email", userId)).length, 3);
  });

  await check("confirm: the link plus the account's password confirms the address and logs in", async () => {
    const { email, userId } = await signUpUnverified("verify-ok");
    const token = await newestVerificationToken(userId);
    assert.ok(verificationTokenSchema.safeParse(token).success, "our shape check rejects a real token");
    const result = await confirm(token, testPassword, "verify-ok");
    assert.equal(result.ok, true, messageOf(result));
    assert.deepEqual(await accountState(userId), { email, verified: true, sessions: 1 });
    // Opening the same link again later (with the password) just logs in again.
    assert.equal((await confirm(token, testPassword, "verify-ok-again")).ok, true);
    assert.equal((await accountState(userId)).sessions, 2);
  });

  await check("confirm: the link alone, or with a wrong password, confirms nothing and opens no session", async () => {
    const { email, userId } = await signUpUnverified("verify-link-only");
    const token = await newestVerificationToken(userId);
    for (const password of ["", "not-the-password-at-all"]) {
      assert.match(messageOf(await confirm(token, password, "verify-link-only")), WRONG_LINK_OR_PASSWORD);
    }
    assert.deepEqual(await accountState(userId), { email, verified: false, sessions: 0 });
  });

  await check("confirm: Better Auth's own verifyEmail opens no session (auto sign-in is off)", async () => {
    const { userId } = await signUpUnverified("verify-no-auto-login");
    await auth.api.verifyEmail({ query: { token: await newestVerificationToken(userId) } });
    assert.equal((await accountState(userId)).sessions, 0);
  });

  await check("confirm: bad links are refused even with the right password, with the wrong-password message", async () => {
    const { email, userId } = await signUpUnverified("verify-bad");
    const genuine = await createEmailVerificationToken(env.BETTER_AUTH_SECRET, email, undefined, 3600);
    const [header, payload, signature] = genuine.split(".");
    const otherEmail = Buffer.from(JSON.stringify({ email: "someone-else@example.test" })).toString("base64url");
    const badTokens = [
      `${header}.${otherEmail}.${signature}`, // payload swapped, signature no longer matches
      await createEmailVerificationToken("x".repeat(40), email, undefined, 3600), // wrong secret
      await createEmailVerificationToken(env.BETTER_AUTH_SECRET, email, undefined, -60), // expired
      `${header}.${payload}.${"A".repeat(signature.length)}`, // signature replaced
      // A genuine "change my address" token: Better Auth logs its clicker in.
      // The new address comes from testEmail, so cleanup still finds the user
      // if a broken check ever lets Better Auth rename it.
      await createEmailVerificationToken(env.BETTER_AUTH_SECRET, email, testEmail("verify-bad-changed"), 3600),
      "not-a-token",
    ];
    for (const token of badTokens) {
      assert.match(messageOf(await confirm(token, testPassword, "verify-bad")), WRONG_LINK_OR_PASSWORD);
    }
    assert.deepEqual(await accountState(userId), { email, verified: false, sessions: 0 });
  });

  await check("confirm: password guesses count per address and IP, together with the login page", async () => {
    const { email, userId } = await signUpUnverified("verify-guessing");
    const token = await newestVerificationToken(userId);
    for (let guess = 0; guess < 10; guess++) {
      assert.match(messageOf(await confirm(token, `wrong-guess-${guess}`, "verify-guess")), WRONG_LINK_OR_PASSWORD);
    }
    assert.match(messageOf(await confirm(token, testPassword, "verify-guess")), TOO_MANY_ATTEMPTS);
    const loginHere = await logIn({ email, password: testPassword }, requestHeadersFrom("verify-guess"), ignoreKnownDeviceCookie);
    assert.match(messageOf(loginHere), /Too many login attempts/);
    // Someone else's guesses never lock the account's owner out elsewhere
    // (guessing spread over many IPs is checked in login-limit-checks.ts).
    const loginElsewhere = await logIn({ email, password: testPassword }, requestHeadersFrom("verify-guess-owner"), ignoreKnownDeviceCookie);
    assert.match(messageOf(loginElsewhere), /Please confirm your email address first/);
    assert.deepEqual(await accountState(userId), { email, verified: false, sessions: 0 });
  });

  await check("confirm: too many attempts from one client address are refused", async () => {
    const forged = await createEmailVerificationToken("x".repeat(40), `nobody-${runId}@example.test`, undefined, 3600);
    for (let attempt = 0; attempt < 20; attempt++) {
      assert.match(messageOf(await confirm(forged, testPassword, "verify-one-ip")), WRONG_LINK_OR_PASSWORD);
    }
    assert.match(messageOf(await confirm(forged, testPassword, "verify-one-ip")), TOO_MANY_ATTEMPTS);
  });

  await check("verification: the token shape check rejects junk before Better Auth sees it", async () => {
    for (const junk of ["", "abc", "a.b", "a.b.c.d", "a.b.<script>", "x".repeat(2001)]) {
      assert.equal(verificationTokenSchema.safeParse(junk).success, false, `accepted "${junk.slice(0, 20)}"`);
    }
  });
}
