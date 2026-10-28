// Known-device checks (step 22): strangers who fill an address's login cap
// from many IPs can't keep the person out of a browser they logged in with
// before, while that browser's cookie counts only for its own address, can't
// be altered, and gives a thief only 10 tries per 15 minutes.

import assert from "node:assert/strict";
import type { FormResult } from "@/lib/form-result";
import { readKnownDeviceId } from "@/lib/known-device";
import { logIn } from "@/services/auth";
import { findLoginLimitReached } from "@/services/login-limits";
import { ignoreKnownDeviceCookie, requestHeadersFrom, requestHeadersWithKnownDevice } from "./account-helpers";
import { check, signUpTestOwner, testPassword } from "./helpers";
import { fillAddressCap, ipOf } from "./login-limit-checks";

function messageOf(result: FormResult): string {
  return result.ok ? "(it worked)" : (result.errors.message ?? "(no message)");
}

// Logs in through the login service the way the login form does, and returns
// the known-device cookie it handed this browser.
async function logInAndKeepDeviceCookie(email: string, clientLabel: string): Promise<string> {
  const handedOut: string[] = [];
  const result = await logIn({ email, password: testPassword }, requestHeadersFrom(clientLabel), (cookieValue) => {
    handedOut.push(cookieValue);
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(handedOut.length, 1, "the login handed out no known-device cookie");
  return handedOut[0];
}

function knownDeviceIdOf(cookie: string, email: string): string | null {
  return readKnownDeviceId(requestHeadersWithKnownDevice("device-read", cookie), email);
}

export async function runKnownDeviceChecks() {
  await check("known device: strangers filling the address's cap can't keep the person out of a browser they used before", async () => {
    const user = await signUpTestOwner("device-victim");
    const laptopCookie = await logInAndKeepDeviceCookie(user.email, "device-victim-laptop");
    await fillAddressCap(user.email, "device-strangers");
    // A browser that never logged in to this account is refused for the hour...
    const newPhone = await logIn({ email: user.email, password: testPassword }, requestHeadersFrom("device-victim-phone"), ignoreKnownDeviceCookie);
    assert.match(messageOf(newPhone), /Try again in an hour, or from a browser you have logged in with before/);
    // ...but the laptop still gets in, from any network.
    const laptop = await logIn(
      { email: user.email, password: testPassword },
      requestHeadersWithKnownDevice("device-victim-cafe", laptopCookie),
      ignoreKnownDeviceCookie,
    );
    assert.deepEqual(laptop, { ok: true });
  });

  await check("known device: the cookie only counts for its own address and can't be altered", async () => {
    const user = await signUpTestOwner("device-owner");
    const otherUser = await signUpTestOwner("device-other");
    const cookie = await logInAndKeepDeviceCookie(user.email, "device-owner-home");
    assert.ok(knownDeviceIdOf(cookie, user.email), "a genuine cookie was refused");
    assert.equal(knownDeviceIdOf(cookie, otherUser.email), null, "the cookie worked for another address");
    const [deviceId, expiresAt, signature] = cookie.split(".");
    const otherFirstCharacter = signature.startsWith("A") ? "B" : "A";
    const altered = [
      `${deviceId}.${Number(expiresAt) + 60}.${signature}`, // a later expiry
      `x${deviceId}.${expiresAt}.${signature}`, // another device id
      `${deviceId}.${expiresAt}.${otherFirstCharacter}${signature.slice(1)}`, // a forged signature
      `${cookie}.extra`,
      "",
    ];
    for (const value of altered) {
      assert.equal(knownDeviceIdOf(value, user.email), null, `accepted "${value}"`);
    }
  });

  await check("known device: a stolen cookie gives 10 tries per 15 minutes, from however many IPs", async () => {
    const user = await signUpTestOwner("device-stolen");
    const cookie = await logInAndKeepDeviceCookie(user.email, "device-stolen-home");
    const deviceId = knownDeviceIdOf(cookie, user.email);
    for (let ipNumber = 0; ipNumber < 10; ipNumber++) {
      const attempt = { email: user.email, ip: ipOf(`device-thief-${ipNumber}`), knownDeviceId: deviceId };
      assert.equal(await findLoginLimitReached(attempt), null);
    }
    const eleventh = await logIn(
      { email: user.email, password: testPassword },
      requestHeadersWithKnownDevice("device-thief-last", cookie),
      ignoreKnownDeviceCookie,
    );
    assert.match(messageOf(eleventh), /Too many login attempts\. Try again in 15 minutes/);
  });
}
