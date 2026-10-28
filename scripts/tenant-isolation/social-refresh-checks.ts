// Social token checks (step 40): before a platform call, a token about to
// run out is renewed where the platform allows it (X, Google), saved in one
// UPDATE; a refused renewal marks the connection "needs reconnecting", a
// silent platform leaves it usable; LinkedIn past its 60 days needs a
// reconnect; Facebook Page tokens and the stand-in's are used as they are;
// a renewal racing a disconnect or another renewal never wins over it.
// Through services/social-tokens.ts and /db, with fake platforms only.

import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { socialConnections } from "@/db/schema";
import { decryptText } from "@/lib/encryption";
import { socialTokenContext } from "@/lib/encryption-contexts";
import type { SessionContext } from "@/lib/session";
import type { SocialPlatform } from "@/lib/social-platforms";
import { getSocialAccountsPageForSession } from "@/services/social-accounts";
import { connectStandInAccountForSession } from "@/services/social-connect";
import { disconnectSocialAccountForSession } from "@/services/social-disconnect";
import { prepareConnectionForUse } from "@/services/social-tokens";
import { check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { collectingAfter } from "./media-helpers";
import { connectFully, connectionRows, everyPlatformReal, everyPlatformStandIn, facebookConnects, fakePlatform, json, linkedInConnects, noPlatform, xConnects, youTubeConnects } from "./social-helpers";

// The company's one connection of a platform, as stored.
async function rowOf(session: SessionContext, platform: SocialPlatform) {
  const row = (await connectionRows(session.companyId)).find((connection) => connection.platform === platform);
  assert.ok(row, `no ${platform} connection`);
  return row;
}

// Makes the stored access token run out in `minutes` (negative: ran out).
async function expireIn(connectionId: string, minutes: number): Promise<void> {
  await db.update(socialConnections).set({ accessExpiresAt: new Date(Date.now() + minutes * 60 * 1000) }).where(eq(socialConnections.id, connectionId));
}

const decryptAccess = (session: SessionContext, id: string, encrypted: string | null) => decryptText(encrypted ?? "", socialTokenContext(session.companyId, id, "access"));

export async function runSocialRefreshChecks() {
  await check("social tokens: an X token that runs out within 5 minutes is renewed and saved in one UPDATE (X's new refresh token kept); one with more time is used as it is, without asking X", async () => {
    const owner = sessionFor(await signUpTestOwner("social-renew"));
    await connectFully(owner, "x", xConnects());
    const before = await rowOf(owner, "x");
    const fresh = await prepareConnectionForUse(owner.companyId, before.id, { modeOf: everyPlatformReal, fetchFn: noPlatform });
    assert.ok(fresh.kind === "ready" && fresh.target.accessToken === `x-access-${runId}`);
    await expireIn(before.id, 3);
    const x = fakePlatform([json({ token_type: "bearer", expires_in: 7200, access_token: `x-access-2-${runId}`, refresh_token: `x-refresh-2-${runId}` })]);
    const renewed = await prepareConnectionForUse(owner.companyId, before.id, { modeOf: everyPlatformReal, fetchFn: x.fetchFn });
    assert.ok(renewed.kind === "ready" && renewed.target.accessToken === `x-access-2-${runId}`, JSON.stringify(renewed.kind));
    assert.equal(new URLSearchParams(String(x.requests[0].body)).get("refresh_token"), `x-refresh-${runId}`);
    const after = await rowOf(owner, "x");
    assert.equal(decryptAccess(owner, after.id, after.accessTokenEncrypted), `x-access-2-${runId}`);
    assert.equal(decryptText(after.refreshTokenEncrypted ?? "", socialTokenContext(owner.companyId, after.id, "refresh")), `x-refresh-2-${runId}`);
    assert.ok(after.accessExpiresAt && after.accessExpiresAt.getTime() > Date.now() + 100 * 60 * 1000, "the new expiry was not saved");
    assert.deepEqual([after.status, after.lastError], ["connected", null]);
  });

  await check("social tokens: a refused renewal marks the connection needing a reconnect (refresh_refused), shown on the Accounts page; a platform that doesn't answer leaves it connected with refresh_unavailable, cleared by the next renewal", async () => {
    const owner = sessionFor(await signUpTestOwner("social-renew-fail"));
    await connectFully(owner, "youtube", youTubeConnects());
    const row = await rowOf(owner, "youtube");
    await expireIn(row.id, 1);
    const silent = await prepareConnectionForUse(owner.companyId, row.id, { modeOf: everyPlatformReal, fetchFn: fakePlatform([new Response(null, { status: 503 })]).fetchFn });
    assert.deepEqual(silent, { kind: "unavailable", code: "refresh_unavailable" });
    assert.deepEqual([(await rowOf(owner, "youtube")).status, (await rowOf(owner, "youtube")).lastError], ["connected", "refresh_unavailable"]);
    const google = fakePlatform([json({ access_token: `yt-access-2-${runId}`, expires_in: 3599 })]);
    assert.equal((await prepareConnectionForUse(owner.companyId, row.id, { modeOf: everyPlatformReal, fetchFn: google.fetchFn })).kind, "ready");
    const renewed = await rowOf(owner, "youtube");
    assert.deepEqual([renewed.lastError, decryptText(renewed.refreshTokenEncrypted ?? "", socialTokenContext(owner.companyId, row.id, "refresh"))], [null, `yt-refresh-${runId}`]);
    await expireIn(row.id, 2);
    const refused = await prepareConnectionForUse(owner.companyId, row.id, { modeOf: everyPlatformReal, fetchFn: fakePlatform([json({ error: "invalid_grant" }, 400)]).fetchFn });
    assert.deepEqual(refused, { kind: "needs_reauth", code: "refresh_refused" });
    const marked = await rowOf(owner, "youtube");
    assert.deepEqual([marked.status, marked.lastError], ["needs_reauth", "refresh_refused"]);
    assert.ok(marked.accessTokenEncrypted, "the tokens went (a disconnect still needs them to revoke)");
    // Marked: nobody asks Google again until an owner reconnects.
    assert.deepEqual(await prepareConnectionForUse(owner.companyId, row.id, { modeOf: everyPlatformReal, fetchFn: noPlatform }), { kind: "needs_reauth", code: "refresh_refused" });
    const page = await getSocialAccountsPageForSession(owner, { modeOf: everyPlatformReal });
    const [shown] = page.platforms.find((platform) => platform.platform === "youtube")?.connections ?? [];
    assert.deepEqual([shown.status, shown.problem], ["needs_reauth", "YouTube no longer accepts ansa's permission (it may have been removed in YouTube's settings). Reconnect to keep posting."]);
    // A server whose app is gone can't renew: nothing is marked on the connection.
    const other = sessionFor(await signUpTestOwner("social-renew-off"));
    await connectFully(other, "x", xConnects());
    const xRow = await rowOf(other, "x");
    await expireIn(xRow.id, 1);
    assert.deepEqual(await prepareConnectionForUse(other.companyId, xRow.id, { modeOf: () => ({ kind: "not-set-up" }), fetchFn: noPlatform }), { kind: "unavailable", code: "not_set_up" });
    assert.deepEqual([(await rowOf(other, "x")).status, (await rowOf(other, "x")).lastError], ["connected", null]);
  });

  await check("social tokens: a LinkedIn token past its 60 days needs a reconnect (token_expired) without asking LinkedIn, and the Accounts page says so even before; Facebook Page tokens and the stand-in's are used as they are", async () => {
    const owner = sessionFor(await signUpTestOwner("social-renew-linkedin"));
    await connectFully(owner, "linkedin", linkedInConnects());
    const linkedIn = await rowOf(owner, "linkedin");
    await expireIn(linkedIn.id, 3);
    // Within its last minutes it still works: LinkedIn can't renew it anyway.
    assert.equal((await prepareConnectionForUse(owner.companyId, linkedIn.id, { modeOf: everyPlatformReal, fetchFn: noPlatform })).kind, "ready");
    await expireIn(linkedIn.id, -1);
    const page = await getSocialAccountsPageForSession(owner, { modeOf: everyPlatformReal });
    const [shown] = page.platforms.find((platform) => platform.platform === "linkedin")?.connections ?? [];
    assert.deepEqual([shown.status, shown.lifetime.kind], ["needs_reauth", "ran-out"]);
    assert.match(shown.problem ?? "", /permission ran out \(it lasts 60 days/);
    assert.deepEqual(await prepareConnectionForUse(owner.companyId, linkedIn.id, { modeOf: everyPlatformReal, fetchFn: noPlatform }), { kind: "needs_reauth", code: "token_expired" });
    assert.deepEqual([(await rowOf(owner, "linkedin")).status, (await rowOf(owner, "linkedin")).lastError], ["needs_reauth", "token_expired"]);
    await connectFully(owner, "facebook", facebookConnects([{ id: "555", name: "Ansa Bakery", tasks: ["CREATE_CONTENT"] }]));
    const page555 = await rowOf(owner, "facebook");
    assert.equal(page555.accessExpiresAt, null);
    const facebook = await prepareConnectionForUse(owner.companyId, page555.id, { modeOf: everyPlatformReal, fetchFn: noPlatform });
    assert.ok(facebook.kind === "ready" && facebook.target.accessToken === `fb-page-555-${runId}`);
    const standInOwner = sessionFor(await signUpTestOwner("social-renew-stand-in"));
    assert.deepEqual(await connectStandInAccountForSession(standInOwner, { platform: "youtube" }, { modeOf: everyPlatformStandIn }), { ok: true });
    const standIn = await rowOf(standInOwner, "youtube");
    const ready = await prepareConnectionForUse(standInOwner.companyId, standIn.id, { modeOf: everyPlatformStandIn, fetchFn: noPlatform });
    assert.ok(ready.kind === "ready" && ready.isStandIn);
  });

  await check("social tokens: a renewal racing a disconnect never brings the tokens back, and one racing another renewal ends with the newer token", async () => {
    const owner = sessionFor(await signUpTestOwner("social-renew-race"));
    await connectFully(owner, "x", xConnects());
    const row = await rowOf(owner, "x");
    await expireIn(row.id, 1);
    // X answers only once the owner has disconnected meanwhile.
    const slowX = fakePlatform([
      async () => {
        assert.deepEqual(await disconnectSocialAccountForSession(owner, { connectionId: row.id }, collectingAfter().run, { modeOf: everyPlatformReal, fetchFn: noPlatform }), { ok: true });
        return json({ expires_in: 7200, access_token: `x-late-${runId}`, refresh_token: `x-late-refresh-${runId}` });
      },
    ]);
    assert.deepEqual(await prepareConnectionForUse(owner.companyId, row.id, { modeOf: everyPlatformReal, fetchFn: slowX.fetchFn }), { kind: "disconnected" });
    const gone = await rowOf(owner, "x");
    assert.deepEqual([gone.status, gone.accessTokenEncrypted, gone.refreshTokenEncrypted], ["disconnected", null, null]);
    // Two runs renewing at once, as when one's claim looks over a minute old
    // (social-renewal-checks.ts): the later save finds the other one's token, and uses it.
    const other = sessionFor(await signUpTestOwner("social-renew-race-2"));
    await connectFully(other, "x", xConnects());
    const xRow = await rowOf(other, "x");
    await expireIn(xRow.id, 1);
    const firstRun = fakePlatform([json({ expires_in: 7200, access_token: `x-first-${runId}`, refresh_token: `x-first-refresh-${runId}` })]);
    const secondRun = fakePlatform([
      async () => {
        await db.update(socialConnections).set({ renewalStartedAt: sql`now() - interval '2 minutes'` }).where(eq(socialConnections.id, xRow.id));
        const first = await prepareConnectionForUse(other.companyId, xRow.id, { modeOf: everyPlatformReal, fetchFn: firstRun.fetchFn });
        assert.ok(first.kind === "ready" && first.target.accessToken === `x-first-${runId}`);
        return json({ expires_in: 7200, access_token: `x-second-${runId}`, refresh_token: `x-second-refresh-${runId}` });
      },
    ]);
    const second = await prepareConnectionForUse(other.companyId, xRow.id, { modeOf: everyPlatformReal, fetchFn: secondRun.fetchFn });
    assert.ok(second.kind === "ready" && second.target.accessToken === `x-first-${runId}`, "the older renewal won");
    assert.equal(decryptAccess(other, xRow.id, (await rowOf(other, "x")).accessTokenEncrypted), `x-first-${runId}`);
  });
}
