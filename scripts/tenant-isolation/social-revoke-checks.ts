// Social disconnect checks (step 40 review): Google's grant, and maybe X's,
// belongs to the platform account and ansa's one app, not to a company. So
// a Disconnect never has it revoked while the account is still connected
// anywhere (another company's connection, or the same company's made
// again, would end too), and the last company to disconnect it has it
// revoked; the answer is the same either way. The list of platforms that
// revoke matches their adapters. Fake platforms only.

import assert from "node:assert/strict";
import { markNeedsReauth } from "@/db/social-connection-tokens";
import { REVOKES_ON_REQUEST, socialPlatforms } from "@/lib/social-platforms";
import { adapterFor } from "@/lib/social-publishing";
import { disconnectSocialAccountForSession } from "@/services/social-disconnect";
import { prepareConnectionForUse } from "@/services/social-tokens";
import { captureConsole, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { collectingAfter } from "./media-helpers";
import { connectFully, connectionRows, everyPlatformReal, fakeCredentials, fakePlatform, noPlatform, ownXAccountId, ownYouTubeChannelId, xConnects, youTubeConnects } from "./social-helpers";

export async function runSocialRevokeChecks() {
  await check("social accounts: Disconnect doesn't ask Google or X to revoke while another company still has that channel or account connected, or waiting for a reconnect (it would end theirs too); once no other company has it, Disconnect does", async () => {
    const ownerA = sessionFor(await signUpTestOwner("social-shared-a"));
    const ownerB = sessionFor(await signUpTestOwner("social-shared-b"));
    const channelId = ownYouTubeChannelId();
    const xAccountId = ownXAccountId();
    for (const owner of [ownerA, ownerB]) {
      await connectFully(owner, "youtube", youTubeConnects(channelId));
      await connectFully(owner, "x", xConnects(xAccountId));
    }
    const rowsOfB = await connectionRows(ownerB.companyId);
    const xOfB = rowsOfB.find((row) => row.platform === "x");
    const youTubeOfB = rowsOfB.find((row) => row.platform === "youtube");
    assert.ok(xOfB && youTubeOfB);
    // B's X connection waits for a reconnect: it still holds that account's tokens.
    assert.equal(await markNeedsReauth(ownerB.companyId, xOfB.id, xOfB.accessTokenEncrypted ?? "", "refresh_refused"), true);
    const platforms = fakePlatform([]);
    const after = collectingAfter();
    for (const row of await connectionRows(ownerA.companyId)) {
      assert.deepEqual(await disconnectSocialAccountForSession(ownerA, { connectionId: row.id }, after.run, { modeOf: everyPlatformReal, fetchFn: platforms.fetchFn }), { ok: true });
    }
    const { logs } = await captureConsole(() => after.settle());
    assert.equal(platforms.requests.length, 0, "a platform was asked to revoke a grant another company still has");
    assert.deepEqual(logs.sort(), ["Social revoke skipped: x account still connected", "Social revoke skipped: youtube account still connected"]);
    assert.ok((await connectionRows(ownerA.companyId)).every((row) => row.status === "disconnected" && row.accessTokenEncrypted === null && row.refreshTokenEncrypted === null));
    const stillUsable = await prepareConnectionForUse(ownerB.companyId, youTubeOfB.id, { modeOf: everyPlatformReal, fetchFn: noPlatform });
    assert.equal(stillUsable.kind, "ready");
    // B is the last company with them: now Google and X are asked.
    const revoking = fakePlatform([new Response(null, { status: 200 }), new Response(null, { status: 200 }), new Response(null, { status: 200 })]);
    for (const row of rowsOfB) {
      assert.deepEqual(await disconnectSocialAccountForSession(ownerB, { connectionId: row.id }, after.run, { modeOf: everyPlatformReal, fetchFn: revoking.fetchFn }), { ok: true });
    }
    await after.settle();
    assert.deepEqual(revoking.requests.map((request) => request.url).sort(), ["https://api.x.com/2/oauth2/revoke", "https://api.x.com/2/oauth2/revoke", "https://oauth2.googleapis.com/revoke"]);
  });

  await check("social accounts: an account connected again before its Disconnect's revoke ran keeps its new connection (Google's grant is the same one)", async () => {
    const owner = sessionFor(await signUpTestOwner("social-shared-again"));
    const channelId = ownYouTubeChannelId();
    await connectFully(owner, "youtube", youTubeConnects(channelId));
    const [row] = await connectionRows(owner.companyId);
    const google = fakePlatform([new Response(null, { status: 200 })]);
    const after = collectingAfter();
    assert.deepEqual(await disconnectSocialAccountForSession(owner, { connectionId: row.id }, after.run, { modeOf: everyPlatformReal, fetchFn: google.fetchFn }), { ok: true });
    await connectFully(owner, "youtube", youTubeConnects(channelId));
    await captureConsole(() => after.settle());
    assert.equal(google.requests.length, 0, "the revoke ended the new connection's grant");
    assert.equal((await prepareConnectionForUse(owner.companyId, row.id, { modeOf: everyPlatformReal, fetchFn: noPlatform })).kind, "ready");
  });

  await check("social accounts: the platforms the Disconnect question says take ansa's access back (REVOKES_ON_REQUEST) are exactly those whose adapter revokes", async () => {
    for (const platform of socialPlatforms) {
      const accepting = fakePlatform([new Response(null, { status: 200 }), new Response(null, { status: 200 })]);
      const context = { credentials: fakeCredentials(platform), fetchFn: accepting.fetchFn, now: new Date() };
      const revoked = await adapterFor(platform).revoke({ accessToken: `access-${runId}`, refreshToken: `refresh-${runId}` }, context);
      assert.equal(revoked.kind, REVOKES_ON_REQUEST.includes(platform) ? "revoked" : "not_offered", platform);
    }
  });
}
