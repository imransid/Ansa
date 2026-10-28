// Social stand-in checks (step 40): in development a platform without its
// app offers a stand-in account, which publishes to .dev-social/; production
// refuses it and says a platform without its app isn't set up, naming no
// setting; the startup warnings and the settings' rules; and the generic
// layer's redirect URI. Nothing leaves this machine.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { linkedInAdapter } from "@/adapters/linkedin";
import { decryptText } from "@/lib/encryption";
import { socialTokenContext } from "@/lib/encryption-contexts";
import { describeInvalidSettings, env, parseEnv } from "@/lib/env";
import { findProductionSettingProblems, findStandInLeftovers } from "@/lib/production-warnings";
import { platformModeFor, socialCallbackUrl } from "@/lib/social-mode";
import { socialPlatforms, STAND_IN_ACCOUNT_ID } from "@/lib/social-platforms";
import { buildAuthorizeUrl, completeAuthorization, fetchPostMetrics, publishPost } from "@/lib/social-publishing";
import type { SocialPost } from "@/lib/social-types";
import { getSocialAccountsPageForSession } from "@/services/social-accounts";
import { connectStandInAccountForSession, startSocialConnectionForSession } from "@/services/social-connect";
import { messageOf } from "./cofounder-helpers";
import { captureConsole, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { MP4, PNG } from "./media-helpers";
import { connectionRows, fakeCredentials, fakePlatform, linkedInConnects, noPlatform, trackStandInPost } from "./social-helpers";

const STAND_IN_TARGET = { externalAccountId: STAND_IN_ACCOUNT_ID, accessToken: "dev-stand-in-token" };
const standIn = { kind: "stand-in" } as const;

// The fewest settings lib/env.ts accepts, all made up.
function validSettings(): Record<string, string> {
  return {
    DATABASE_URL: "postgres://x@localhost/x",
    BETTER_AUTH_SECRET: "s".repeat(32),
    BETTER_AUTH_URL: "http://localhost:3000",
    DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
    VAPI_WEBHOOK_SECRET: "v".repeat(32),
  };
}

export async function runSocialStandInChecks() {
  await check("social stand-in: in development a platform without its app offers a stand-in account; connecting one asks no platform and makes one connection marked as the stand-in's; connecting again renews that same one", async () => {
    const owner = sessionFor(await signUpTestOwner("social-stand-in"));
    // This server's own settings: no platform app (local-only.ts refuses one), not production.
    const page = await getSocialAccountsPageForSession(owner);
    assert.ok(page.showsOperatorNotes && page.platforms.every((platform) => platform.mode === "stand-in" && platform.missingSettings !== null));
    assert.equal(messageOf(await startSocialConnectionForSession(owner, { platform: "linkedin" })), "LinkedIn isn't set up on this development server: connect a stand-in account instead.");
    assert.deepEqual(await connectStandInAccountForSession(owner, { platform: "linkedin" }), { ok: true });
    const [first] = await connectionRows(owner.companyId);
    assert.deepEqual(
      [first.externalAccountId, first.isStandIn, first.displayName, first.accountKind, first.status, first.accessExpiresAt, first.refreshTokenEncrypted],
      [STAND_IN_ACCOUNT_ID, true, "Development stand-in (LinkedIn)", "member", "connected", null, null],
    );
    assert.deepEqual(first.scopes, [...linkedInAdapter.scopes]);
    assert.match(decryptText(first.accessTokenEncrypted ?? "", socialTokenContext(owner.companyId, first.id, "access")), /^dev-stand-in-[0-9a-f-]{36}$/);
    assert.deepEqual(await connectStandInAccountForSession(owner, { platform: "linkedin" }), { ok: true });
    const rows = await connectionRows(owner.companyId);
    assert.deepEqual([rows.length, rows[0].id], [1, first.id]);
    assert.notEqual(rows[0].accessTokenEncrypted, first.accessTokenEncrypted);
    // Every platform has its own.
    for (const platform of socialPlatforms.filter((name) => name !== "linkedin")) {
      assert.deepEqual(await connectStandInAccountForSession(owner, { platform }), { ok: true });
    }
    assert.deepEqual((await connectionRows(owner.companyId)).map((row) => row.accountKind).sort(), ["account", "channel", "member", "page"]);
    // With the platform's app set, the stand-in isn't offered.
    assert.match(messageOf(await connectStandInAccountForSession(owner, { platform: "x" }, { modeOf: (platform) => ({ kind: "real", credentials: fakeCredentials(platform) }) })), /only be connected on a development server/);
  });

  await check("social stand-in: publishing through it writes .dev-social/<platform>/<time>-<id>.json (the post, never the file's bytes) and answers published with a dev id; a YouTube text post and a LinkedIn video are refused as the real ones would be", async () => {
    const post: SocialPost = { text: `Fresh bread ${runId}`, title: "", media: { kind: "image", contentType: "image/png", bytes: PNG, altText: "Three loaves" } };
    const { result, logs } = await captureConsole(() => publishPost({ platform: "x", isStandIn: true }, STAND_IN_TARGET, post, standIn, { fetchFn: noPlatform, now: new Date() }));
    const fileName = await trackStandInPost("x", result);
    assert.ok(result.kind === "published" && result.url === null && /^dev-[0-9a-f-]{36}$/.test(result.externalPostId), JSON.stringify(result));
    assert.ok(fileName && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z-[0-9a-f-]{36}\.json$/.test(fileName), `no file for ${result.externalPostId}`);
    const written = JSON.parse(await readFile(path.join(process.cwd(), ".dev-social", "x", fileName), "utf8"));
    assert.deepEqual([written.platform, written.account_id, written.text, written.media], ["x", STAND_IN_ACCOUNT_ID, `Fresh bread ${runId}`, { kind: "image", content_type: "image/png", size_bytes: PNG.length, alt_text: "Three loaves" }]);
    assert.match(written.note, /NOT published/);
    assert.ok(!JSON.stringify(written).includes(PNG.toString("base64").slice(0, 40)), "the image's bytes were copied");
    assert.deepEqual(logs, [`[dev social] Not published. Saved to .dev-social/x/${fileName}`]);
    const youTubeText = await publishPost({ platform: "youtube", isStandIn: true }, STAND_IN_TARGET, { text: "Hi", title: "Hi", media: null }, standIn, { fetchFn: noPlatform, now: new Date() });
    await trackStandInPost("youtube", youTubeText);
    assert.deepEqual(youTubeText, { kind: "not_created", code: "text_posts_not_supported" });
    const video: SocialPost = { text: "Hi", title: "", media: { kind: "video", contentType: "video/mp4", bytes: MP4, altText: "" } };
    const linkedInVideo = await publishPost({ platform: "linkedin", isStandIn: true }, STAND_IN_TARGET, video, standIn, { fetchFn: noPlatform, now: new Date() });
    await trackStandInPost("linkedin", linkedInVideo);
    assert.deepEqual(linkedInVideo, { kind: "not_created", code: "video_not_supported" });
    const youTubeVideo = await publishPost({ platform: "youtube", isStandIn: true }, STAND_IN_TARGET, { ...video, title: "Our bakery" }, standIn, { fetchFn: noPlatform, now: new Date() });
    assert.ok(await trackStandInPost("youtube", youTubeVideo), "a YouTube video wrote no file");
  });

  await check("social stand-in: production refuses it, connecting and publishing; there a platform without its app is 'not set up': no stand-in, no Connect, no setting named, and a real account on it publishes nothing", async () => {
    const owner = sessionFor(await signUpTestOwner("social-production"));
    const production = { nodeEnv: "production" };
    assert.match(messageOf(await connectStandInAccountForSession(owner, { platform: "x" }, production)), /only be connected on a development server/);
    assert.equal((await connectionRows(owner.companyId)).length, 0);
    const post: SocialPost = { text: "Hi", title: "", media: null };
    const inProduction = await publishPost({ platform: "x", isStandIn: true }, STAND_IN_TARGET, post, { kind: "not-set-up" }, { fetchFn: noPlatform, now: new Date(), nodeEnv: "production" });
    await trackStandInPost("x", inProduction);
    assert.deepEqual(inProduction, { kind: "not_created", code: "stand_in_in_production" });
    const page = await getSocialAccountsPageForSession(owner, production);
    assert.ok(!page.showsOperatorNotes && page.platforms.every((platform) => platform.mode === "not-set-up" && platform.missingSettings === null));
    assert.ok(!/CLIENT_ID|APP_ID|CLIENT_SECRET|APP_SECRET/.test(JSON.stringify(page)), "the production page names a setting");
    assert.equal(messageOf(await startSocialConnectionForSession(owner, { platform: "x" }, production)), "X isn't set up by ansa yet.");
    assert.deepEqual(platformModeFor("x", {}, "production"), { kind: "not-set-up" });
    assert.deepEqual(platformModeFor("x", {}, "development"), { kind: "stand-in" });
    assert.deepEqual(platformModeFor("x", { X_CLIENT_ID: "a", X_CLIENT_SECRET: "b" }, "production"), { kind: "real", credentials: { clientId: "a", clientSecret: "b" } });
    const realAccount = await publishPost({ platform: "x", isStandIn: false }, { externalAccountId: "1", accessToken: "t" }, post, { kind: "not-set-up" }, { fetchFn: noPlatform, now: new Date() });
    assert.deepEqual(realAccount, { kind: "not_created", code: "not_set_up" });
  });

  await check("social stand-in: the startup warnings name each social platform ansa hasn't set up and a .dev-social/ folder holding files, never a value; each app's id and secret go together, or the server doesn't start", async () => {
    const problems = findProductionSettingProblems(parseEnv(validSettings())).join("\n");
    for (const [id, secret, label] of [["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "LinkedIn"], ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET", "Facebook"], ["X_CLIENT_ID", "X_CLIENT_SECRET", "X"], ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "YouTube"]]) {
      assert.ok(problems.includes(`${id} and ${secret} are not set: ${label} accounts can't be connected`), `no warning for ${label}`);
    }
    const linkedInSet = findProductionSettingProblems(parseEnv({ ...validSettings(), LINKEDIN_CLIENT_ID: `id-${runId}`, LINKEDIN_CLIENT_SECRET: `secret-${runId}` })).join("\n");
    assert.ok(!linkedInSet.includes("LINKEDIN_CLIENT_ID") && !linkedInSet.includes(runId));
    assert.match(findStandInLeftovers(parseEnv(validSettings()), (folder) => folder === ".dev-social").join("\n"), /\.dev-social\/ holds posts the development stand-in wrote/);
    assert.deepEqual(findStandInLeftovers(parseEnv(validSettings()), () => false), []);
    for (const [given, missing] of [["X_CLIENT_ID", "X_CLIENT_SECRET"], ["GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_ID"], ["FACEBOOK_APP_SECRET", "FACEBOOK_APP_ID"]]) {
      assert.throws(
        () => parseEnv({ ...validSettings(), [given]: `value-${runId}` }),
        (error: unknown) => {
          const described = describeInvalidSettings(error as Parameters<typeof describeInvalidSettings>[0]);
          return described.includes(`${missing}:`) && described.includes("must be set together") && !described.includes(runId);
        },
      );
    }
  });

  await check("social layer: the consent screen and the code exchange both send BETTER_AUTH_URL + /api/social/<platform>/callback as the redirect URI; the stand-in never makes post numbers up (step 42: they come from pnpm simulate:post-metrics), and a platform ansa hasn't set up reads none", async () => {
    const credentials = fakeCredentials("linkedin");
    const authorize = new URL(buildAuthorizeUrl("linkedin", credentials, { state: "s", codeChallenge: null }));
    assert.equal(authorize.searchParams.get("redirect_uri"), socialCallbackUrl("linkedin"));
    assert.equal(socialCallbackUrl("linkedin"), new URL("/api/social/linkedin/callback", env.BETTER_AUTH_URL).toString());
    assert.equal(socialCallbackUrl("x", "https://app.example.com/"), "https://app.example.com/api/social/x/callback");
    const platform = fakePlatform(linkedInConnects());
    await completeAuthorization("linkedin", credentials, { code: "c", codeVerifier: null }, { fetchFn: platform.fetchFn, now: new Date() });
    assert.equal(new URLSearchParams(String(platform.requests[0].body)).get("redirect_uri"), socialCallbackUrl("linkedin"));
    const target = { externalAccountId: "dev:stand-in", accessToken: "t" };
    const request = { externalPostId: "dev-1", publishedAt: new Date() };
    const options = { fetchFn: noPlatform, now: new Date() };
    assert.deepEqual(await fetchPostMetrics({ platform: "linkedin", isStandIn: true }, target, request, { kind: "stand-in" }, options), { kind: "unavailable", code: "stand_in" });
    assert.deepEqual(await fetchPostMetrics({ platform: "x", isStandIn: false }, target, request, { kind: "not-set-up" }, options), { kind: "unavailable", code: "not_set_up" });
  });
}
