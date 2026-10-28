// Social adapter checks (step 40), X and YouTube: every request is the one
// the platform documents, checked by a fake platform that records method,
// address, headers and body; every answer maps to the code the research's
// "not created" and "unclear" lists say; and a request that never answers
// is cut off by its time limit. No real platform.

import assert from "node:assert/strict";
import { xAdapter } from "@/adapters/x";
import { youTubeAdapter } from "@/adapters/youtube";
import { sendToPlatform } from "@/lib/social-http";
import type { SocialFetch, SocialPost } from "@/lib/social-types";
import { MP4, PNG } from "./media-helpers";
import { check, runId } from "./helpers";
import { fakeCredentials, fakePlatform, json, xConnects, youTubeConnects } from "./social-helpers";

const REDIRECT = "https://app.ansa.test/api/social/callback-for-checks";
const now = new Date("2026-10-28T12:00:00Z");
const contextFor = (platform: "x" | "youtube", fetchFn: SocialFetch) => ({ credentials: fakeCredentials(platform), fetchFn, now });
const formOf = (body: unknown) => Object.fromEntries(new URLSearchParams(String(body)));
const basic = (platform: "x" | "youtube") => `Basic ${Buffer.from(`client-${platform}-${runId}:app-secret-${platform}-${runId}`).toString("base64")}`;
const video = (title: string): SocialPost => ({ text: "How we bake", title, media: { kind: "video", contentType: "video/mp4", bytes: MP4, altText: "" } });
const SESSION = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=xa298sd_f";

export async function runSocialAdapterMoreChecks() {
  await check("x: the consent screen (PKCE S256), the code exchange (HTTP Basic with the verifier, no client_id in the body), users/me, renewing (a new refresh token kept, else the old) and revoking are the requests X documents", async () => {
    const authorize = new URL(xAdapter.buildAuthorizeUrl({ clientId: "cid", redirectUri: REDIRECT, state: "the-state", codeChallenge: "the-challenge" }));
    assert.equal(`${authorize.origin}${authorize.pathname}`, "https://x.com/i/oauth2/authorize");
    assert.deepEqual(Object.fromEntries(authorize.searchParams), {
      response_type: "code",
      client_id: "cid",
      redirect_uri: REDIRECT,
      scope: "tweet.read tweet.write users.read offline.access media.write",
      state: "the-state",
      code_challenge: "the-challenge",
      code_challenge_method: "S256",
    });
    const platform = fakePlatform(xConnects("1234567890", "ansabakery"));
    const result = await xAdapter.completeAuthorization({ code: "the-code", redirectUri: REDIRECT, codeVerifier: "the-verifier" }, contextFor("x", platform.fetchFn));
    const [exchange, me] = platform.requests;
    assert.deepEqual([exchange.method, exchange.url, exchange.headers.authorization, exchange.headers["content-type"]], ["POST", "https://api.x.com/2/oauth2/token", basic("x"), "application/x-www-form-urlencoded"]);
    assert.deepEqual(formOf(exchange.body), { code: "the-code", grant_type: "authorization_code", redirect_uri: REDIRECT, code_verifier: "the-verifier" });
    assert.deepEqual([me.method, me.url, me.headers.authorization], ["GET", "https://api.x.com/2/users/me", `Bearer x-access-${runId}`]);
    assert.ok(result.kind === "authorized");
    const [account] = result.accounts;
    assert.deepEqual([account.externalAccountId, account.displayName, account.refreshToken, account.accessExpiresAt], ["1234567890", "Ansa Bakery (@ansabakery)", `x-refresh-${runId}`, new Date(now.getTime() + 7200 * 1000)]);
    const rotating = fakePlatform([json({ token_type: "bearer", expires_in: 7200, access_token: "new-access", refresh_token: "new-refresh" }), json({ expires_in: 7200, access_token: "newer-access" })]);
    assert.deepEqual(await xAdapter.refreshTokens("old-refresh", contextFor("x", rotating.fetchFn)), { kind: "refreshed", accessToken: "new-access", refreshToken: "new-refresh", accessExpiresAt: new Date(now.getTime() + 7200 * 1000), refreshExpiresAt: null });
    assert.deepEqual(formOf(rotating.requests[0].body), { refresh_token: "old-refresh", grant_type: "refresh_token" });
    assert.equal(rotating.requests[0].headers.authorization, basic("x"));
    const kept = await xAdapter.refreshTokens("old-refresh", contextFor("x", rotating.fetchFn));
    assert.ok(kept.kind === "refreshed" && kept.refreshToken === "old-refresh");
    assert.deepEqual(await xAdapter.refreshTokens("r", contextFor("x", fakePlatform([json({ error: "invalid_request" }, 400)]).fetchFn)), { kind: "refused" });
    assert.deepEqual(await xAdapter.refreshTokens("r", contextFor("x", fakePlatform([new Response(null, { status: 503 })]).fetchFn)), { kind: "unavailable" });
  });

  await check("x: a post is POST /2/tweets as JSON (an image first through the v2 media upload, multipart with media_category tweet_image); 429 waits until x-rate-limit-reset, 400, 401, 403 and 404 created nothing, 503 and a 2xx without data.id are unclear", async () => {
    const target = { externalAccountId: "1234567890", accessToken: "user-token" };
    const text = fakePlatform([json({ data: { id: "1460323737035677698", text: "Hi" } }, 201)]);
    assert.deepEqual(await xAdapter.publish(target, { text: "Fresh bread #sourdough", title: "", media: null }, contextFor("x", text.fetchFn)), {
      kind: "published",
      externalPostId: "1460323737035677698",
      url: "https://x.com/i/web/status/1460323737035677698",
    });
    assert.deepEqual([text.requests[0].method, text.requests[0].url, text.requests[0].headers], ["POST", "https://api.x.com/2/tweets", { authorization: "Bearer user-token", "content-type": "application/json" }]);
    assert.deepEqual(JSON.parse(String(text.requests[0].body)), { text: "Fresh bread #sourdough" });
    const image = fakePlatform([json({ data: { id: "1146654567674912769", media_key: "3_1146654567674912769", size: 100 } }), json({ data: { id: "1460323737035677699" } }, 201)]);
    const post: SocialPost = { text: "Look", title: "", media: { kind: "image", contentType: "image/png", bytes: PNG, altText: "" } };
    assert.equal((await xAdapter.publish(target, post, contextFor("x", image.fetchFn))).kind, "published");
    const [upload, tweet] = image.requests;
    assert.deepEqual([upload.method, upload.url, upload.headers.authorization], ["POST", "https://api.x.com/2/media/upload", "Bearer user-token"]);
    const form = upload.body as FormData;
    assert.equal(form.get("media_category"), "tweet_image");
    assert.ok(Buffer.from(await (form.get("media") as Blob).arrayBuffer()).equals(PNG));
    assert.deepEqual(JSON.parse(String(tweet.body)), { text: "Look", media: { media_ids: ["1146654567674912769"] } });
    const resetIn90 = String(Math.floor(now.getTime() / 1000) + 90);
    const cases: [Response, unknown][] = [
      [json({ title: "Too Many Requests" }, 429, { "x-rate-limit-reset": resetIn90 }), { kind: "not_created", code: "rate_limited", retryAfterSeconds: 90 }],
      [json({}, 400), { kind: "not_created", code: "invalid_request" }],
      [json({}, 401), { kind: "not_created", code: "token_rejected" }],
      [json({ detail: "This user is not allowed to post a video longer than 2 minutes." }, 403), { kind: "not_created", code: "permission_denied" }],
      [json({}, 404), { kind: "not_created", code: "not_found" }],
      [json({}, 503), { kind: "unclear", code: "server_error" }],
      [json({}, 500), { kind: "unclear", code: "server_error" }],
      [json({ errors: [{ message: "partial" }] }, 200), { kind: "unclear", code: "no_post_id" }],
    ];
    for (const [answer, expected] of cases) {
      assert.deepEqual(await xAdapter.publish(target, { text: "Hi", title: "", media: null }, contextFor("x", fakePlatform([answer]).fetchFn)), expected, `${answer.status}`);
    }
    // A refused upload posts nothing.
    const refusedUpload = fakePlatform([json({}, 400)]);
    assert.deepEqual(await xAdapter.publish(target, post, contextFor("x", refusedUpload.fetchFn)), { kind: "not_created", code: "upload_failed" });
    assert.equal(refusedUpload.requests.length, 1);
  });

  await check("youtube: Google's consent screen (offline access, the consent prompt, PKCE S256, both scopes), the code exchange and channels.list are the requests Google documents; no channel or an unticked permission connects nothing; renewing: invalid_grant is refused, a 503 unavailable", async () => {
    const authorize = new URL(youTubeAdapter.buildAuthorizeUrl({ clientId: "cid", redirectUri: REDIRECT, state: "the-state", codeChallenge: "the-challenge" }));
    assert.equal(`${authorize.origin}${authorize.pathname}`, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.deepEqual(Object.fromEntries(authorize.searchParams), {
      client_id: "cid",
      redirect_uri: REDIRECT,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
      access_type: "offline",
      prompt: "consent",
      state: "the-state",
      code_challenge: "the-challenge",
      code_challenge_method: "S256",
    });
    const platform = fakePlatform(youTubeConnects("UCabcdefghijklmnopqrstuv"));
    const result = await youTubeAdapter.completeAuthorization({ code: "the-code", redirectUri: REDIRECT, codeVerifier: "the-verifier" }, contextFor("youtube", platform.fetchFn));
    const [exchange, channels] = platform.requests;
    assert.deepEqual([exchange.method, exchange.url, exchange.headers["content-type"]], ["POST", "https://oauth2.googleapis.com/token", "application/x-www-form-urlencoded"]);
    assert.deepEqual(formOf(exchange.body), {
      code: "the-code",
      client_id: `client-youtube-${runId}`,
      client_secret: `app-secret-youtube-${runId}`,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
      code_verifier: "the-verifier",
    });
    assert.deepEqual([channels.method, channels.url, channels.headers.authorization], ["GET", "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", `Bearer yt-access-${runId}`]);
    assert.ok(result.kind === "authorized" && result.accounts[0].displayName === "Ansa Bakery TV" && result.accounts[0].refreshToken === `yt-refresh-${runId}`);
    const noChannel = youTubeConnects();
    noChannel[1] = json({ items: [] });
    assert.deepEqual(await youTubeAdapter.completeAuthorization({ code: "c", redirectUri: REDIRECT, codeVerifier: "v" }, contextFor("youtube", fakePlatform(noChannel).fetchFn)), { kind: "failed", code: "no_channel" });
    const unticked = fakePlatform([json({ access_token: "t", expires_in: 3599, scope: "https://www.googleapis.com/auth/youtube.readonly" })]);
    assert.deepEqual(await youTubeAdapter.completeAuthorization({ code: "c", redirectUri: REDIRECT, codeVerifier: "v" }, contextFor("youtube", unticked.fetchFn)), { kind: "failed", code: "missing_permission" });
    assert.equal(unticked.requests.length, 1, "the channel was read without the permission");
    const renewing = fakePlatform([json({ access_token: "fresh", expires_in: 3599, token_type: "Bearer" })]);
    assert.deepEqual(await youTubeAdapter.refreshTokens("the-refresh", contextFor("youtube", renewing.fetchFn)), { kind: "refreshed", accessToken: "fresh", refreshToken: "the-refresh", accessExpiresAt: new Date(now.getTime() + 3599 * 1000), refreshExpiresAt: null });
    assert.deepEqual(formOf(renewing.requests[0].body), { client_id: `client-youtube-${runId}`, client_secret: `app-secret-youtube-${runId}`, refresh_token: "the-refresh", grant_type: "refresh_token" });
    assert.deepEqual(await youTubeAdapter.refreshTokens("r", contextFor("youtube", fakePlatform([json({ error: "invalid_grant" }, 400)]).fetchFn)), { kind: "refused" });
    assert.deepEqual(await youTubeAdapter.refreshTokens("r", contextFor("youtube", fakePlatform([new Response(null, { status: 503 })]).fetchFn)), { kind: "unavailable" });
  });

  await check("youtube: a video is the resumable videos.insert (a POST with its details and X-Upload headers, then a PUT of the bytes to the session address on Google's host); a text post or no title asks nothing; a 4xx at the start created nothing, a 503 during the upload is unclear, a 404 an expired session", async () => {
    const target = { externalAccountId: "UCabcdefghijklmnopqrstuv", accessToken: "channel-token" };
    const started = () => new Response(null, { status: 200, headers: { location: SESSION } });
    const platform = fakePlatform([started(), json({ id: "dQw4w9WgXcQ", snippet: { title: "Our bakery" } }, 201)]);
    assert.deepEqual(await youTubeAdapter.publish(target, video("Our bakery"), contextFor("youtube", platform.fetchFn)), { kind: "published", externalPostId: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
    const [start, upload] = platform.requests;
    assert.deepEqual([start.method, start.url], ["POST", "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status"]);
    assert.deepEqual(start.headers, { authorization: "Bearer channel-token", "content-type": "application/json; charset=UTF-8", "x-upload-content-length": String(MP4.length), "x-upload-content-type": "video/mp4" });
    assert.deepEqual(JSON.parse(String(start.body)), { snippet: { title: "Our bakery", description: "How we bake" }, status: { privacyStatus: "public" } });
    assert.deepEqual([upload.method, upload.url, upload.headers], ["PUT", SESSION, { authorization: "Bearer channel-token", "content-type": "video/mp4" }]);
    assert.ok(Buffer.from(upload.body as Uint8Array).equals(MP4));
    const none = fakePlatform([]);
    assert.deepEqual(await youTubeAdapter.publish(target, { text: "Hi", title: "Hi", media: null }, contextFor("youtube", none.fetchFn)), { kind: "not_created", code: "text_posts_not_supported" });
    assert.deepEqual(await youTubeAdapter.publish(target, video("  "), contextFor("youtube", none.fetchFn)), { kind: "not_created", code: "title_missing" });
    assert.equal(none.requests.length, 0);
    const googleError = (status: number, reason: string) => json({ error: { code: status, message: `quota ${runId}`, errors: [{ reason, domain: "youtube.quota" }] } }, status);
    const cases: [Response[], unknown][] = [
      [[googleError(403, "quotaExceeded")], { kind: "not_created", code: "quota_exceeded" }],
      [[googleError(400, "uploadLimitExceeded")], { kind: "not_created", code: "quota_exceeded" }],
      [[googleError(403, "forbidden")], { kind: "not_created", code: "permission_denied" }],
      [[googleError(401, "authError")], { kind: "not_created", code: "token_rejected" }],
      [[new Response(null, { status: 503 })], { kind: "not_created", code: "upload_failed" }],
      [[new Response(null, { status: 200, headers: { location: "https://uploads.evil.test/x" } })], { kind: "not_created", code: "upload_url_refused" }],
      [[started(), new Response(null, { status: 503 })], { kind: "unclear", code: "upload_interrupted" }],
      [[started(), new Response(null, { status: 404 })], { kind: "not_created", code: "upload_session_expired" }],
      [[started(), googleError(400, "invalidTitle")], { kind: "not_created", code: "invalid_request" }],
      [[started(), json({ kind: "youtube#video" }, 200)], { kind: "unclear", code: "no_post_id" }],
    ];
    for (const [answers, expected] of cases) {
      const fake = fakePlatform(answers);
      assert.deepEqual(await youTubeAdapter.publish(target, video("Our bakery"), contextFor("youtube", fake.fetchFn)), expected, JSON.stringify(expected));
      assert.ok(fake.requests.every((request) => !request.url.includes("evil")), "the channel's token went to another host");
    }
  });

  await check("adapters: a request to a platform has a time limit, follows no redirect and is never cached; one that never answers is cut off and ends as a timeout, one that fails as a network error", async () => {
    let seen: RequestInit = {};
    const neverAnswers: SocialFetch = (_url, init) => {
      seen = init;
      return new Promise((_resolve, reject) => {
        // WHY a timer of its own: without a time limit this request would
        // hang, and a run with nothing left to wait for ends silently.
        const guard = setTimeout(() => reject(new Error("never cut off")), 1_000);
        init.signal?.addEventListener("abort", () => {
          clearTimeout(guard);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    };
    const started = Date.now();
    assert.deepEqual(await sendToPlatform(neverAnswers, "https://api.x.com/2/tweets", { method: "POST" }, 50), { kind: "no_answer", code: "timeout" });
    assert.ok(Date.now() - started < 900, "the time limit didn't cut it off");
    assert.deepEqual([seen.redirect, seen.cache, seen.signal instanceof AbortSignal], ["manual", "no-store", true]);
    const failing: SocialFetch = async () => {
      throw new TypeError(`fetch failed: getaddrinfo ENOTFOUND api.x.com ${runId}`);
    };
    assert.deepEqual(await sendToPlatform(failing, "https://api.x.com/2/tweets", { method: "POST" }, 1_000), { kind: "no_answer", code: "network_error" });
  });
}
