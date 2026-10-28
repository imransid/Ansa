// Social account checks (step 40), part 2: connections. Tokens are stored
// encrypted for their company, connection and kind; another company can't
// see, use or disconnect one; members can't connect or disconnect;
// reconnecting updates the account's own row; Facebook connects one
// account per Page; Disconnect deletes the tokens and asks X and Google to
// revoke after the answer. Fake platforms only (social-helpers.ts).

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createOauthState } from "@/db/oauth-states";
import { disconnectSocialConnection } from "@/db/social-connection-disconnects";
import { getConnectionWithTokens, markNeedsReauth, saveRenewedTokens } from "@/db/social-connection-tokens";
import { saveSocialConnections } from "@/db/social-connections";
import { decryptText } from "@/lib/encryption";
import { socialTokenContext } from "@/lib/encryption-contexts";
import { getSocialAccountsPageForSession } from "@/services/social-accounts";
import { connectStandInAccountForSession, startSocialConnectionForSession } from "@/services/social-connect";
import { disconnectSocialAccountForSession } from "@/services/social-disconnect";
import { prepareConnectionForUse } from "@/services/social-tokens";
import { messageOf } from "./cofounder-helpers";
import { addTeammate, captureConsole, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { collectingAfter } from "./media-helpers";
import { connectFully, connectionRows, everyPlatformReal, everyPlatformStandIn, facebookConnects, fakePlatform, json, linkedInConnects, ownXAccountId, ownYouTubeChannelId, stateRows, xConnects, youTubeConnects } from "./social-helpers";

const CONNECTED = (platform: string) => `/cofounder/accounts?result=connected&platform=${platform}`;

export async function runSocialConnectionChecks() {
  await check("social accounts: tokens are stored encrypted, with a context naming the company, the connection and the token kind; none of the three can be swapped", async () => {
    const owner = sessionFor(await signUpTestOwner("social-tokens"));
    const other = sessionFor(await signUpTestOwner("social-tokens-other"));
    assert.equal((await connectFully(owner, "x", xConnects())).landing, CONNECTED("x"));
    const [row] = await connectionRows(owner.companyId);
    const access = row.accessTokenEncrypted ?? "";
    const refresh = row.refreshTokenEncrypted ?? "";
    assert.ok(access.startsWith("v1:") && refresh.startsWith("v1:"));
    assert.ok(!access.includes(`x-access-${runId}`) && !refresh.includes(`x-refresh-${runId}`), "a token is stored readable");
    assert.equal(decryptText(access, socialTokenContext(owner.companyId, row.id, "access")), `x-access-${runId}`);
    assert.equal(decryptText(refresh, socialTokenContext(owner.companyId, row.id, "refresh")), `x-refresh-${runId}`);
    assert.throws(() => decryptText(access, socialTokenContext(other.companyId, row.id, "access")));
    assert.throws(() => decryptText(access, socialTokenContext(owner.companyId, randomUUID(), "access")));
    assert.throws(() => decryptText(access, socialTokenContext(owner.companyId, row.id, "refresh")));
    assert.deepEqual([row.platform, row.externalAccountId, row.displayName, row.accountKind, row.status, row.isStandIn], ["x", "1234567890", "Ansa Bakery (@ansabakery)", "account", "connected", false]);
    assert.deepEqual(row.scopes, ["tweet.read", "tweet.write", "users.read", "offline.access", "media.write"]);
    assert.ok(row.accessExpiresAt && Math.abs(row.accessExpiresAt.getTime() - Date.now() - 7200 * 1000) < 60_000, "X's two hours were not kept");
  });

  await check("social accounts: another company can't list, use, renew or disconnect a company's connection (services and /db); its own owner can", async () => {
    const ownerA = sessionFor(await signUpTestOwner("social-tenant-a"));
    const ownerB = sessionFor(await signUpTestOwner("social-tenant-b"));
    assert.equal((await connectFully(ownerA, "linkedin", linkedInConnects(`member${runId}`, `Ana ${runId}`))).landing, CONNECTED("linkedin"));
    const [row] = await connectionRows(ownerA.companyId);
    const pageOfB = await getSocialAccountsPageForSession(ownerB, { modeOf: everyPlatformReal });
    assert.ok(pageOfB.platforms.every((platform) => platform.connections.length === 0 && platform.disconnected.length === 0));
    assert.ok(!JSON.stringify(pageOfB).includes(runId), "B's page shows A's account");
    assert.deepEqual(await prepareConnectionForUse(ownerB.companyId, row.id, { modeOf: everyPlatformReal }), { kind: "not_found" });
    assert.equal(await getConnectionWithTokens(ownerB.companyId, row.id), null);
    assert.equal(await saveRenewedTokens(ownerB.companyId, row.id, row.accessTokenEncrypted ?? "", { accessTokenEncrypted: "v1:x:y:z", refreshTokenEncrypted: null, accessExpiresAt: null, refreshExpiresAt: null }), false);
    assert.equal(await markNeedsReauth(ownerB.companyId, row.id, row.accessTokenEncrypted ?? "", "refresh_refused"), false);
    assert.equal(messageOf(await disconnectSocialAccountForSession(ownerB, { connectionId: row.id }, collectingAfter().run)), "That account was not found in your company.");
    assert.deepEqual(await disconnectSocialConnection(ownerB.companyId, ownerB.userId, row.id), { outcome: "not-found" });
    const [unchanged] = await connectionRows(ownerA.companyId);
    assert.deepEqual([unchanged.status, unchanged.accessTokenEncrypted, unchanged.lastError], ["connected", row.accessTokenEncrypted, null]);
    const ready = await prepareConnectionForUse(ownerA.companyId, row.id, { modeOf: everyPlatformReal });
    assert.ok(ready.kind === "ready" && ready.target.accessToken === `li-access-${runId}` && ready.target.externalAccountId === `member${runId}`, JSON.stringify(ready.kind));
    // Another company connecting the very same LinkedIn member gets a row of its own.
    assert.equal((await connectFully(ownerB, "linkedin", linkedInConnects(`member${runId}`, `Ana ${runId}`))).landing, CONNECTED("linkedin"));
    assert.equal((await connectionRows(ownerA.companyId)).length, 1);
    assert.equal((await connectionRows(ownerB.companyId)).length, 1);
  });

  await check("social accounts: members can't start a connection, connect a stand-in or disconnect (services and /db), and nothing is written; members see the page without its buttons", async () => {
    const ownerUser = await signUpTestOwner("social-members");
    const owner = sessionFor(ownerUser);
    const member = sessionFor(await addTeammate(ownerUser, "social-member", "member"));
    assert.equal(messageOf(await startSocialConnectionForSession(member, { platform: "x" }, { modeOf: everyPlatformReal })), "Only owners can connect accounts.");
    assert.equal(messageOf(await connectStandInAccountForSession(member, { platform: "x" }, { modeOf: everyPlatformStandIn })), "Only owners can connect accounts.");
    // A session that still says owner: /db reads the role again.
    assert.equal(messageOf(await startSocialConnectionForSession({ ...member, role: "owner" }, { platform: "x" }, { modeOf: everyPlatformReal })), "Only owners can connect accounts.");
    assert.equal(messageOf(await connectStandInAccountForSession({ ...member, role: "owner" }, { platform: "x" }, { modeOf: everyPlatformStandIn })), "Only owners can connect accounts.");
    assert.deepEqual([await stateRows(owner.companyId), await connectionRows(owner.companyId)], [[], []]);
    const newState = { id: randomUUID(), platform: "linkedin" as const, stateHash: "a".repeat(64), pkceVerifierEncrypted: null };
    assert.equal(await createOauthState(owner.companyId, member.userId, newState), "not-allowed");
    const toSave = { id: randomUUID(), externalAccountId: "m1", displayName: "M", accountKind: "member" as const, scopes: [], accessTokenEncrypted: "v1:a:b:c", refreshTokenEncrypted: null, accessExpiresAt: null, refreshExpiresAt: null };
    assert.equal(await saveSocialConnections(owner.companyId, member.userId, "linkedin", false, [toSave]), "not-allowed");
    assert.deepEqual(await connectStandInAccountForSession(owner, { platform: "x" }, { modeOf: everyPlatformStandIn }), { ok: true });
    const [standIn] = await connectionRows(owner.companyId);
    assert.equal(messageOf(await disconnectSocialAccountForSession(member, { connectionId: standIn.id }, collectingAfter().run)), "Only owners can disconnect accounts.");
    assert.equal(messageOf(await disconnectSocialAccountForSession({ ...member, role: "owner" }, { connectionId: standIn.id }, collectingAfter().run)), "Only owners can disconnect accounts.");
    assert.deepEqual(await disconnectSocialConnection(owner.companyId, member.userId, standIn.id), { outcome: "not-allowed" });
    assert.equal((await connectionRows(owner.companyId))[0].status, "connected");
    const page = await getSocialAccountsPageForSession(member, { modeOf: everyPlatformStandIn });
    assert.equal(page.canManage, false);
    assert.equal(page.platforms.find((platform) => platform.platform === "x")?.connections.length, 1, "members don't see the accounts");
  });

  await check("social accounts: reconnecting an account updates its own row (same id, new tokens, connected again by whoever reconnected); a disconnected one comes back", async () => {
    const ownerUser = await signUpTestOwner("social-reconnect");
    const owner = sessionFor(ownerUser);
    const coOwner = sessionFor(await addTeammate(ownerUser, "social-reconnect-co", "owner"));
    await connectFully(owner, "youtube", youTubeConnects());
    const [first] = await connectionRows(owner.companyId);
    assert.deepEqual(await disconnectSocialAccountForSession(owner, { connectionId: first.id }, collectingAfter().run, { modeOf: everyPlatformReal }), { ok: true });
    const renewed = youTubeConnects();
    renewed[0] = json({ access_token: `yt-access-again-${runId}`, expires_in: 3599, refresh_token: `yt-refresh-again-${runId}`, scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly" });
    assert.equal((await connectFully(coOwner, "youtube", renewed)).landing, CONNECTED("youtube"));
    const rows = await connectionRows(owner.companyId);
    assert.equal(rows.length, 1);
    const [again] = rows;
    assert.deepEqual([again.id, again.status, again.disconnectedAt, again.connectedByUserId, again.lastError], [first.id, "connected", null, coOwner.userId, null]);
    assert.equal(decryptText(again.accessTokenEncrypted ?? "", socialTokenContext(owner.companyId, again.id, "access")), `yt-access-again-${runId}`);
    assert.equal(decryptText(again.refreshTokenEncrypted ?? "", socialTokenContext(owner.companyId, again.id, "refresh")), `yt-refresh-again-${runId}`);
    assert.ok(again.connectedAt.getTime() >= first.connectedAt.getTime());
  });

  await check("social accounts: Facebook connects one account per Page the person may create content on, each with that Page's own token and no expiry; no such Page, or an unticked permission, connects nothing", async () => {
    const owner = sessionFor(await signUpTestOwner("social-facebook"));
    const pages = [
      { id: "111", name: "Ansa Bakery", tasks: ["ANALYZE", "CREATE_CONTENT", "MODERATE"] },
      { id: "222", name: "Ansa Cafe", tasks: ["CREATE_CONTENT"] },
      { id: "333", name: "Read only", tasks: ["ANALYZE"] },
    ];
    assert.equal((await connectFully(owner, "facebook", facebookConnects(pages))).landing, "/cofounder/accounts?result=connected&platform=facebook&count=2");
    const rows = (await connectionRows(owner.companyId)).sort((first, second) => first.externalAccountId.localeCompare(second.externalAccountId));
    assert.deepEqual(rows.map((row) => [row.externalAccountId, row.displayName, row.accountKind, row.accessExpiresAt, row.refreshTokenEncrypted]), [
      ["111", "Ansa Bakery", "page", null, null],
      ["222", "Ansa Cafe", "page", null, null],
    ]);
    for (const row of rows) {
      assert.equal(decryptText(row.accessTokenEncrypted ?? "", socialTokenContext(owner.companyId, row.id, "access")), `fb-page-${row.externalAccountId}-${runId}`);
      assert.ok(row.scopes.includes("pages_manage_posts") && !row.scopes.includes(`fb-long-${runId}`));
    }
    const other = sessionFor(await signUpTestOwner("social-facebook-none"));
    assert.match((await connectFully(other, "facebook", facebookConnects([pages[2]]))).landing, /result=no_pages&platform=facebook$/);
    assert.match((await connectFully(other, "facebook", facebookConnects(pages, ["pages_show_list", "pages_read_engagement"]))).landing, /result=missing_permission/);
    // Posting needs pages_read_engagement too (research, section 2).
    assert.match((await connectFully(other, "facebook", facebookConnects(pages, ["pages_show_list", "pages_manage_posts"]))).landing, /result=missing_permission/);
    assert.equal((await connectionRows(other.companyId)).length, 0);
  });

  await check("social accounts: Disconnect deletes the tokens and keeps the row; after the answer X and Google are asked to revoke, LinkedIn, Facebook and the stand-in aren't; a failed revoke is one fixed line", async () => {
    const owner = sessionFor(await signUpTestOwner("social-disconnect"));
    await connectFully(owner, "x", xConnects(ownXAccountId()));
    await connectFully(owner, "linkedin", linkedInConnects());
    const rows = await connectionRows(owner.companyId);
    const xRow = rows.find((row) => row.platform === "x");
    const linkedInRow = rows.find((row) => row.platform === "linkedin");
    assert.ok(xRow && linkedInRow);
    const revoking = fakePlatform([new Response(null, { status: 200 }), new Response(null, { status: 200 })]);
    const after = collectingAfter();
    assert.deepEqual(await disconnectSocialAccountForSession(owner, { connectionId: xRow.id.toUpperCase() }, after.run, { modeOf: everyPlatformReal, fetchFn: revoking.fetchFn }), { ok: true });
    const [gone] = (await connectionRows(owner.companyId)).filter((row) => row.id === xRow.id);
    assert.deepEqual([gone.status, gone.accessTokenEncrypted, gone.refreshTokenEncrypted, gone.accessExpiresAt], ["disconnected", null, null, null]);
    assert.ok(gone.disconnectedAt);
    assert.equal(revoking.requests.length, 0, "the platform was asked before the answer");
    await after.settle();
    assert.deepEqual(revoking.requests.map((request) => [request.method, request.url, new URLSearchParams(String(request.body)).get("token")]), [
      ["POST", "https://api.x.com/2/oauth2/revoke", `x-refresh-${runId}`],
      ["POST", "https://api.x.com/2/oauth2/revoke", `x-access-${runId}`],
    ]);
    assert.equal(revoking.requests[0].headers.authorization, `Basic ${Buffer.from(`client-x-${runId}:app-secret-x-${runId}`).toString("base64")}`);
    // Again: already disconnected, nothing more to revoke.
    assert.deepEqual(await disconnectSocialAccountForSession(owner, { connectionId: xRow.id }, after.run, { modeOf: everyPlatformReal, fetchFn: revoking.fetchFn }), { ok: true });
    assert.equal(after.tasks.length, 0);
    // LinkedIn offers no revoke: nothing is asked.
    const silent = fakePlatform([]);
    await disconnectSocialAccountForSession(owner, { connectionId: linkedInRow.id }, after.run, { modeOf: everyPlatformReal, fetchFn: silent.fetchFn });
    await after.settle();
    assert.equal(silent.requests.length, 0);
    // Google's revoke fails: one fixed line, the account stays disconnected.
    await connectFully(owner, "youtube", youTubeConnects(ownYouTubeChannelId()));
    const youTubeRow = (await connectionRows(owner.companyId)).find((row) => row.platform === "youtube");
    assert.ok(youTubeRow);
    const failing = fakePlatform([new Response(`{"error":"invalid_token ${runId}"}`, { status: 400 })]);
    await disconnectSocialAccountForSession(owner, { connectionId: youTubeRow.id }, after.run, { modeOf: everyPlatformReal, fetchFn: failing.fetchFn });
    const { logs } = await captureConsole(() => after.settle());
    assert.deepEqual(logs, ["Social revoke failed: youtube status_400"]);
    assert.equal(new URLSearchParams(String(failing.requests[0].body)).get("token"), `yt-refresh-${runId}`);
    assert.equal(failing.requests[0].url, "https://oauth2.googleapis.com/revoke");
  });
}
