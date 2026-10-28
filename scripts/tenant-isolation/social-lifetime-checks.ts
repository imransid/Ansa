// Accounts page checks (step 40 review): how long each connection's access
// lasts, as of now, the way services/social-accounts.ts tells the page. A
// refresh token with a known end (Google's 7 days while ansa's app is in
// Testing) renews only until then, and past it the connection needs a
// reconnect once the access has run out, even before anything tried, as
// its next use would say; "ran out on" is only ever said of a date that
// has passed. Fake platforms only.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { socialConnections } from "@/db/schema";
import { markNeedsReauth } from "@/db/social-connection-tokens";
import type { SessionContext } from "@/lib/session";
import type { SocialPlatform } from "@/lib/social-platforms";
import { getSocialAccountsPageForSession } from "@/services/social-accounts";
import { connectStandInAccountForSession } from "@/services/social-connect";
import { prepareConnectionForUse } from "@/services/social-tokens";
import { check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { connectFully, everyPlatformReal, everyPlatformStandIn, facebookConnects, linkedInConnects, noPlatform, ownYouTubeChannelId, xConnects, youTubeConnects } from "./social-helpers";

const DAY_MS = 24 * 60 * 60 * 1000;

// The company's one connection of a platform as the Accounts page shows it.
async function shownConnection(session: SessionContext, platform: SocialPlatform) {
  const page = await getSocialAccountsPageForSession(session, { modeOf: everyPlatformReal });
  const [shown] = page.platforms.find((section) => section.platform === platform)?.connections ?? [];
  assert.ok(shown, `no ${platform} connection on the page`);
  return shown;
}

async function setEnds(connectionId: string, ends: { access?: Date; refresh?: Date }) {
  await db.update(socialConnections).set({ accessExpiresAt: ends.access, refreshExpiresAt: ends.refresh }).where(eq(socialConnections.id, connectionId));
}

export async function runSocialLifetimeChecks() {
  await check("accounts page: a refresh token with a known end renews the access until then; past that end it renews nothing, and once the access has run out too the connection needs a reconnect (refresh_expired), shown before anything tried and as its next use says", async () => {
    const owner = sessionFor(await signUpTestOwner("social-life-testing"));
    await connectFully(owner, "youtube", youTubeConnects(ownYouTubeChannelId(), 7 * 24 * 60 * 60));
    const connected = await shownConnection(owner, "youtube");
    assert.equal(connected.status, "connected");
    assert.ok(connected.lifetime.kind === "renews-itself" && connected.lifetime.until, JSON.stringify(connected.lifetime));
    assert.ok(Math.abs(connected.lifetime.until.getTime() - Date.now() - 7 * DAY_MS) < 60_000, "the 7 days were not kept");
    // Day 8: the hour's access token still works, and nothing can renew it.
    await setEnds(connected.id, { refresh: new Date(Date.now() - 60_000) });
    const lapsing = await shownConnection(owner, "youtube");
    assert.deepEqual([lapsing.status, lapsing.problem, lapsing.lifetime.kind], ["connected", null, "runs-out"]);
    await setEnds(connected.id, { access: new Date(Date.now() - 60_000) });
    const ranOut = await shownConnection(owner, "youtube");
    assert.deepEqual([ranOut.status, ranOut.problem, ranOut.lifetime.kind], ["needs_reauth", "YouTube's permission ran out. Reconnect to keep posting.", "ran-out"]);
    assert.deepEqual(await prepareConnectionForUse(owner.companyId, connected.id, { modeOf: everyPlatformReal, fetchFn: noPlatform }), { kind: "needs_reauth", code: "refresh_expired" });
    // A refresh token without a known end (X's) renews on and on.
    await connectFully(owner, "x", xConnects());
    assert.deepEqual((await shownConnection(owner, "x")).lifetime, { kind: "renews-itself", until: null });
  });

  await check("accounts page: a connection needing a reconnect for another reason (the platform refused its token, as step 41 marks it) says nothing about its access running out while its end is still ahead, and 'ran out' once it has passed; Pages, the stand-in and LinkedIn say what they last", async () => {
    const owner = sessionFor(await signUpTestOwner("social-life-refused"));
    await connectFully(owner, "linkedin", linkedInConnects(`member${runId}`, "Ana Baker"));
    const linkedIn = await shownConnection(owner, "linkedin");
    assert.ok(linkedIn.lifetime.kind === "runs-out" && linkedIn.lifetime.on.getTime() > Date.now() + 59 * DAY_MS, JSON.stringify(linkedIn.lifetime));
    const [row] = await db.select().from(socialConnections).where(eq(socialConnections.id, linkedIn.id));
    assert.equal(await markNeedsReauth(owner.companyId, row.id, row.accessTokenEncrypted ?? "", "token_rejected"), true);
    const refused = await shownConnection(owner, "linkedin");
    assert.deepEqual([refused.status, refused.lifetime.kind], ["needs_reauth", "none"]);
    assert.equal(refused.problem, "LinkedIn refused ansa's permission the last time it was used. Reconnect to keep posting.");
    await setEnds(row.id, { access: new Date(Date.now() - DAY_MS) });
    assert.equal((await shownConnection(owner, "linkedin")).lifetime.kind, "ran-out");
    await connectFully(owner, "facebook", facebookConnects([{ id: "777", name: "Ansa Bakery", tasks: ["CREATE_CONTENT"] }]));
    assert.deepEqual((await shownConnection(owner, "facebook")).lifetime, { kind: "no-end-date" });
    const standInOwner = sessionFor(await signUpTestOwner("social-life-stand-in"));
    assert.deepEqual(await connectStandInAccountForSession(standInOwner, { platform: "linkedin" }, { modeOf: everyPlatformStandIn }), { ok: true });
    const standInPage = await getSocialAccountsPageForSession(standInOwner, { modeOf: everyPlatformStandIn });
    const [standIn] = standInPage.platforms.find((section) => section.platform === "linkedin")?.connections ?? [];
    assert.deepEqual(standIn?.lifetime, { kind: "stand-in" });
  });
}
