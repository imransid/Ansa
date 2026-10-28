// Login and join limit checks (step 22): a stranger's failed logins from
// somewhere else never lock the real user out, a team behind one office IP can
// log in and join, a login whose password is right gives its attempt back to
// every counter (also for an unconfirmed account), guessing spread over many
// IPs still stops at the per-address cap, and an IPv6 address counts as its
// /64 network. (Browsers that logged in before: known-device-checks.ts.)

import assert from "node:assert/strict";
import { createEmailVerificationToken } from "better-auth/api";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import type { FormResult } from "@/lib/form-result";
import { getClientIpFromHeaders } from "@/lib/request-ip";
import { confirmEmailWithPassword, logIn } from "@/services/auth";
import { findLoginLimitReached, forgetSuccessfulLogin } from "@/services/login-limits";
import { joinCompanyWithInvite } from "@/services/signup";
import { ignoreKnownDeviceCookie, newestVerificationToken, requestHeadersFrom } from "./account-helpers";
import { captureConsole, check, inviteAs, runId, signUpTestOwner, testEmail, testPassword } from "./helpers";

const TOO_MANY = /Too many login attempts/;
const WRONG = /Email or password is incorrect/;

function logInFrom(email: string, password: string, clientLabel: string): Promise<FormResult> {
  return logIn({ email, password }, requestHeadersFrom(clientLabel), ignoreKnownDeviceCookie);
}

function messageOf(result: FormResult): string {
  return result.ok ? "(it worked)" : (result.errors.message ?? "(no message)");
}

// The IP address requestHeadersFrom(label) sends, as the login limits see it.
export function ipOf(clientLabel: string): string {
  return `isolation-${runId}-${clientLabel}`;
}

// Counts 100 failed attempts for this address from 10 IPs, 10 each (just under
// the per address + IP limit): what strangers with a few IPs can do in an hour.
// The address's cap across all IPs is then full.
export async function fillAddressCap(email: string, label: string): Promise<void> {
  for (let ipNumber = 0; ipNumber < 10; ipNumber++) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const counted = await findLoginLimitReached({ email, ip: ipOf(`${label}-${ipNumber}`), knownDeviceId: null });
      assert.equal(counted, null);
    }
  }
}

export async function runLoginLimitChecks() {
  await check("login limits: a stranger's failed logins from another IP don't lock the real user out", async () => {
    const user = await signUpTestOwner("limit-victim");
    // Better Auth warns on every wrong password; captured to keep the output short.
    await captureConsole(async () => {
      for (let attempt = 0; attempt < 10; attempt++) {
        assert.match(messageOf(await logInFrom(user.email, `stranger-guess-${attempt}`, "limit-stranger")), WRONG);
      }
    });
    assert.match(messageOf(await logInFrom(user.email, testPassword, "limit-stranger")), TOO_MANY);
    assert.deepEqual(await logInFrom(user.email, testPassword, "limit-victim-home"), { ok: true });
  });

  await check("login limits: a team behind one office IP isn't locked out by its own typos and logins", async () => {
    const teammate = await signUpTestOwner("limit-office");
    // 30 colleagues mistype their address (the old per-IP limit was 20).
    await captureConsole(async () => {
      for (let typo = 0; typo < 30; typo++) {
        assert.match(messageOf(await logInFrom(testEmail(`limit-typo-${typo}`), testPassword, "limit-office")), WRONG);
      }
    });
    // More logins than the 10 per address and IP: logins that work don't count.
    for (let login = 0; login < 12; login++) {
      assert.deepEqual(await logInFrom(teammate.email, testPassword, "limit-office"), { ok: true }, `login ${login + 1}`);
    }
  });

  await check("login limits: more than 100 people logging in from one office IP give their attempts back", async () => {
    const teammate = await signUpTestOwner("limit-busy-office");
    // Counting and giving back without checking passwords: what every login that works does.
    for (let person = 0; person < 105; person++) {
      const attempt = { email: `person-${person}-${runId}@example.test`, ip: ipOf("limit-busy-office"), knownDeviceId: null };
      assert.equal(await findLoginLimitReached(attempt), null, `login ${person + 1}`);
      await forgetSuccessfulLogin(attempt);
    }
    assert.deepEqual(await logInFrom(teammate.email, testPassword, "limit-busy-office"), { ok: true });
  });

  await check("login limits: one person logging in from more than 100 IPs gives the attempts back", async () => {
    const user = await signUpTestOwner("limit-roaming");
    for (let place = 0; place < 105; place++) {
      const attempt = { email: user.email, ip: ipOf(`limit-roaming-${place}`), knownDeviceId: null };
      assert.equal(await findLoginLimitReached(attempt), null, `login ${place + 1}`);
      await forgetSuccessfulLogin(attempt);
    }
    assert.deepEqual(await logInFrom(user.email, testPassword, "limit-roaming-fresh"), { ok: true });
  });

  await check("login limits: the right password on an unconfirmed account isn't a failure, on /login or /verify-email", async () => {
    const email = testEmail("limit-unconfirmed");
    const body = { name: "Unconfirmed", email, password: testPassword, companyName: `Isolation test limit unconfirmed ${runId}` };
    const userId = (await auth.api.signUpEmail({ body })).user.id;
    // More than the 10 attempts per address and IP, all with the right password.
    for (let attempt = 0; attempt < 12; attempt++) {
      assert.match(messageOf(await logInFrom(email, testPassword, "limit-unconfirmed")), /Please confirm your email address first/);
    }
    const confirmed = await confirmEmailWithPassword(
      { token: await newestVerificationToken(userId), password: testPassword },
      requestHeadersFrom("limit-unconfirmed"),
      ignoreKnownDeviceCookie,
    );
    assert.equal(confirmed.ok, true, messageOf(confirmed));
  });

  await check("join limits: 12 teammates joining from one office IP are all let in (the old shared limit was 10)", async () => {
    const owner = await signUpTestOwner("limit-onboarding");
    for (let person = 0; person < 12; person++) {
      const email = testEmail(`limit-joiner-${person}`);
      const inviteToken = await inviteAs(owner, email, "member");
      const joinInput = { inviteToken, name: "Joiner", email, password: testPassword };
      assert.deepEqual(await joinCompanyWithInvite(joinInput, requestHeadersFrom("limit-onboarding")), { ok: true }, `joiner ${person + 1}`);
    }
  });

  await check("login limits: one IP's refused attempts never reach the address's cap across all IPs", async () => {
    const user = await signUpTestOwner("limit-one-ip");
    // Counting attempts without checking passwords: what every failed login does.
    for (let attempt = 0; attempt < 120; attempt++) {
      await findLoginLimitReached({ email: user.email, ip: ipOf("limit-one-ip-stranger"), knownDeviceId: null });
    }
    assert.deepEqual(await logInFrom(user.email, testPassword, "limit-one-ip-home"), { ok: true });
  });

  await check("login limits: guessing spread over many IPs stops at the per-address cap, which says an hour", async () => {
    const user = await signUpTestOwner("limit-spread");
    await fillAddressCap(user.email, "limit-spread");
    // The cap holds even for the right password from a fresh IP (a browser that never logged in).
    const refused = await logInFrom(user.email, testPassword, "limit-spread-fresh");
    assert.match(messageOf(refused), /Too many failed logins for this address\. Try again in an hour/);
    // The confirm page shares the counters, and names the same wait.
    const link = await createEmailVerificationToken(env.BETTER_AUTH_SECRET, user.email);
    const confirm = await confirmEmailWithPassword(
      { token: link, password: testPassword },
      requestHeadersFrom("limit-spread-confirm"),
      ignoreKnownDeviceCookie,
    );
    assert.match(messageOf(confirm), /Too many attempts\. Try again in an hour/);
  });

  await check("rate limits: an IPv6 address counts as its /64 network, an IPv4 address as itself", async () => {
    const keyOf = (address: string) => getClientIpFromHeaders(new Headers({ "x-forwarded-for": address }));
    assert.equal(keyOf("2001:db8:1:2::1"), "2001:db8:1:2::/64");
    assert.equal(keyOf("2001:0DB8:1:2:ffff:ffff:ffff:ffff"), "2001:db8:1:2::/64");
    assert.notEqual(keyOf("2001:db8:1:3::1"), keyOf("2001:db8:1:2::1"));
    assert.equal(keyOf("203.0.113.5, 10.0.0.1"), "203.0.113.5");
    assert.notEqual(keyOf("::ffff:203.0.113.5"), keyOf("::ffff:203.0.113.6"), "IPv4 written as IPv6 shares one key");
  });
}
