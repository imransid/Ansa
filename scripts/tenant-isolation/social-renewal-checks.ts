// Social token renewal checks (step 40 review): one run at a time renews a
// connection's tokens. X may refuse a refresh token once it was used, so a
// second run sending the same one at once could get a refusal, mark the
// connection "needs reconnecting" and throw away the first run's new
// tokens; it waits for them instead. A claim left by a run that died is
// taken over after a minute. A connection id written in capitals finds its
// tokens and reads them. Through services/social-tokens.ts and /db, with
// fake platforms only.

import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { socialConnections } from "@/db/schema";
import { decryptText } from "@/lib/encryption";
import { socialTokenContext } from "@/lib/encryption-contexts";
import { API_TIMEOUT_MS } from "@/lib/social-http";
import type { SessionContext } from "@/lib/session";
import { prepareConnectionForUse } from "@/services/social-tokens";
import { captureConsole, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { connectFully, connectionRows, everyPlatformReal, fakePlatform, json, noPlatform, xConnects } from "./social-helpers";

async function xRowOf(session: SessionContext) {
  const row = (await connectionRows(session.companyId)).find((connection) => connection.platform === "x");
  assert.ok(row, "no X connection");
  return row;
}

// A company's X connection whose token runs out in a minute: its next use renews it.
async function xConnectionRunningOut(label: string) {
  const owner = sessionFor(await signUpTestOwner(label));
  await connectFully(owner, "x", xConnects());
  const row = await xRowOf(owner);
  await db.update(socialConnections).set({ accessExpiresAt: new Date(Date.now() + 60 * 1000) }).where(eq(socialConnections.id, row.id));
  return { owner, row };
}

const renewedTo = (name: string) => json({ token_type: "bearer", expires_in: 7200, access_token: `x-${name}-${runId}`, refresh_token: `x-${name}-refresh-${runId}` });

// A promise and the function that settles it, for a fake that answers only when told.
function signal() {
  let settle!: () => void;
  const settled = new Promise<void>((resolve) => (settle = resolve));
  return { settled, settle };
}

export async function runSocialRenewalChecks() {
  await check("social tokens: two runs renewing one X token at once ask X once: the second waits for the first one's new tokens instead of sending the refresh token X just took (which X refuses, and the connection would need a reconnect)", async () => {
    const { owner, row } = await xConnectionRunningOut("social-renew-once");
    const xWasAsked = signal();
    const xMayAnswer = signal();
    const x = fakePlatform([
      async () => {
        xWasAsked.settle();
        await xMayAnswer.settled;
        return renewedTo("first");
      },
      // What X answers a refresh token it already took.
      json({ error: "invalid_request", error_description: "Value passed for the token was invalid." }, 400),
    ]);
    const firstRun = prepareConnectionForUse(owner.companyId, row.id, { modeOf: everyPlatformReal, fetchFn: x.fetchFn });
    await xWasAsked.settled;
    // The second run starts while the first waits for X, which answers once the second waits.
    const waits: number[] = [];
    const wait = async (milliseconds: number) => {
      waits.push(milliseconds);
      xMayAnswer.settle();
      await firstRun;
    };
    const secondRun = prepareConnectionForUse(owner.companyId, row.id, { modeOf: everyPlatformReal, fetchFn: x.fetchFn, sleep: wait }).finally(xMayAnswer.settle);
    const [first, second] = await Promise.all([firstRun, secondRun]);
    assert.equal(x.requests.length, 1, "X was sent the same refresh token twice");
    assert.ok(first.kind === "ready" && first.target.accessToken === `x-first-${runId}`, JSON.stringify(first));
    assert.ok(second.kind === "ready" && second.target.accessToken === `x-first-${runId}`, JSON.stringify(second));
    assert.equal(waits.length, 1);
    const stored = await xRowOf(owner);
    assert.deepEqual([stored.status, stored.lastError, stored.renewalStartedAt], ["connected", null, null]);
    assert.equal(decryptText(stored.refreshTokenEncrypted ?? "", socialTokenContext(owner.companyId, row.id, "refresh")), `x-first-refresh-${runId}`);
  });

  await check("social tokens: a renewal claimed by a run that is still within its minute is waited for, longer than one renewal may take, and then 'try again later' without asking X or marking anything; a claim over a minute old (its run died) is taken over", async () => {
    const { owner, row } = await xConnectionRunningOut("social-renew-claim");
    await db.update(socialConnections).set({ renewalStartedAt: sql`now() - interval '30 seconds'` }).where(eq(socialConnections.id, row.id));
    const waits: number[] = [];
    const countWaits = async (milliseconds: number) => {
      waits.push(milliseconds);
    };
    const x = fakePlatform([renewedTo("taken-over")]);
    const gaveUp = await prepareConnectionForUse(owner.companyId, row.id, { modeOf: everyPlatformReal, fetchFn: x.fetchFn, sleep: countWaits });
    assert.deepEqual(gaveUp, { kind: "unavailable", code: "refresh_unavailable" });
    assert.equal(x.requests.length, 0, "X was asked while another run held the renewal");
    assert.ok(waits.reduce((total, milliseconds) => total + milliseconds, 0) > API_TIMEOUT_MS, `waited ${waits.length} times only`);
    const untouched = await xRowOf(owner);
    assert.deepEqual([untouched.status, untouched.lastError, untouched.accessTokenEncrypted], ["connected", null, row.accessTokenEncrypted]);
    await db.update(socialConnections).set({ renewalStartedAt: sql`now() - interval '61 seconds'` }).where(eq(socialConnections.id, row.id));
    const renewed = await prepareConnectionForUse(owner.companyId, row.id, { modeOf: everyPlatformReal, fetchFn: x.fetchFn, sleep: countWaits });
    assert.ok(renewed.kind === "ready" && renewed.target.accessToken === `x-taken-over-${runId}`, JSON.stringify(renewed));
    assert.equal((await xRowOf(owner)).renewalStartedAt, null, "the claim stayed after the renewal was saved");
  });

  await check("social tokens: a renewal X refuses or doesn't answer ends its claim with the code noted, so the next run isn't kept waiting; so does connecting the account again", async () => {
    const { owner, row } = await xConnectionRunningOut("social-renew-claim-end");
    const silent = await prepareConnectionForUse(owner.companyId, row.id, { modeOf: everyPlatformReal, fetchFn: fakePlatform([new Response(null, { status: 503 })]).fetchFn });
    assert.deepEqual(silent, { kind: "unavailable", code: "refresh_unavailable" });
    assert.deepEqual([(await xRowOf(owner)).lastError, (await xRowOf(owner)).renewalStartedAt], ["refresh_unavailable", null]);
    const refused = await prepareConnectionForUse(owner.companyId, row.id, { modeOf: everyPlatformReal, fetchFn: fakePlatform([json({ error: "invalid_request" }, 400)]).fetchFn, sleep: noWaiting });
    assert.deepEqual(refused, { kind: "needs_reauth", code: "refresh_refused" });
    assert.deepEqual([(await xRowOf(owner)).status, (await xRowOf(owner)).renewalStartedAt], ["needs_reauth", null]);
    // Connected again (new tokens) while an old renewal still held its claim.
    await connectFully(owner, "x", xConnects());
    await db.update(socialConnections).set({ renewalStartedAt: sql`now()` }).where(eq(socialConnections.id, row.id));
    await connectFully(owner, "x", xConnects());
    assert.deepEqual([(await xRowOf(owner)).status, (await xRowOf(owner)).renewalStartedAt], ["connected", null]);
  });

  await check("social tokens: a connection id written in capitals (as a form or an address may write it) finds its tokens and renews them, read and written under the id Postgres gives back", async () => {
    const { owner, row } = await xConnectionRunningOut("social-renew-capitals");
    const x = fakePlatform([renewedTo("capitals")]);
    const { result: renewed, logs } = await captureConsole(() => prepareConnectionForUse(owner.companyId, row.id.toUpperCase(), { modeOf: everyPlatformReal, fetchFn: x.fetchFn }));
    assert.ok(renewed.kind === "ready" && renewed.target.accessToken === `x-capitals-${runId}`, JSON.stringify(renewed));
    assert.deepEqual(logs, []);
    const stored = await xRowOf(owner);
    assert.equal(decryptText(stored.accessTokenEncrypted ?? "", socialTokenContext(owner.companyId, row.id, "access")), `x-capitals-${runId}`);
    const again = await prepareConnectionForUse(owner.companyId, row.id.toUpperCase(), { modeOf: everyPlatformReal, fetchFn: noPlatform });
    assert.ok(again.kind === "ready" && again.target.accessToken === `x-capitals-${runId}`, JSON.stringify(again));
  });
}

// For a check where no run should wait: waiting fails it.
async function noWaiting(): Promise<void> {
  throw new Error("a run waited where no other run was renewing");
}
