// Social adapter checks (step 40), LinkedIn and Facebook: every request is
// the one the platform documents (docs/research/social-publishing-apis.md
// and the pages its adapter names), checked by a fake platform that records
// the method, address, headers and body; and every answer maps to the code
// the research's "not created" and "unclear" lists say. No real platform.

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { facebookAdapter } from "@/adapters/facebook";
import { linkedInAdapter } from "@/adapters/linkedin";
import { toLinkedInLittleText } from "@/lib/linkedin-text";
import type { SocialFetch, SocialPost } from "@/lib/social-types";
import { PNG, WEBP } from "./media-helpers";
import { check, runId } from "./helpers";
import { facebookConnects, fakeCredentials, fakePlatform, json, linkedInConnects } from "./social-helpers";

const REDIRECT = "https://app.ansa.test/api/social/callback-for-checks";
const now = new Date("2026-10-28T12:00:00Z");
const textPost = (text: string): SocialPost => ({ text, title: "", media: null });
const imagePost = (text: string, bytes = PNG, contentType = "image/png"): SocialPost => ({ text, title: "", media: { kind: "image", contentType, bytes, altText: "Three loaves" } });

function contextFor(platform: "linkedin" | "facebook", fetchFn: SocialFetch) {
  return { credentials: fakeCredentials(platform), fetchFn, now };
}

function formOf(body: unknown): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(String(body)));
}

const posted = (id: string) => new Response(null, { status: 201, headers: { "x-restli-id": id } });

export async function runSocialAdapterChecks() {
  await check("linkedin: the consent screen, the code exchange and the member lookup are the requests LinkedIn documents (no PKCE)", async () => {
    const authorize = new URL(linkedInAdapter.buildAuthorizeUrl({ clientId: "cid", redirectUri: REDIRECT, state: "the-state", codeChallenge: null }));
    assert.equal(`${authorize.origin}${authorize.pathname}`, "https://www.linkedin.com/oauth/v2/authorization");
    assert.deepEqual(Object.fromEntries(authorize.searchParams), { response_type: "code", client_id: "cid", redirect_uri: REDIRECT, state: "the-state", scope: "openid profile w_member_social" });
    assert.match(authorize.search, /scope=openid%20profile%20w_member_social/);
    const platform = fakePlatform(linkedInConnects("abc123", "Ana Baker"));
    const result = await linkedInAdapter.completeAuthorization({ code: "the-code", redirectUri: REDIRECT, codeVerifier: null }, contextFor("linkedin", platform.fetchFn));
    const [exchange, lookup] = platform.requests;
    assert.deepEqual([exchange.method, exchange.url, exchange.headers["content-type"], exchange.headers.authorization], ["POST", "https://www.linkedin.com/oauth/v2/accessToken", "application/x-www-form-urlencoded", undefined]);
    assert.deepEqual(formOf(exchange.body), { grant_type: "authorization_code", code: "the-code", client_id: `client-linkedin-${runId}`, client_secret: `app-secret-linkedin-${runId}`, redirect_uri: REDIRECT });
    assert.deepEqual([lookup.method, lookup.url, lookup.headers.authorization], ["GET", "https://api.linkedin.com/v2/userinfo", `Bearer li-access-${runId}`]);
    assert.ok(platform.requests.every((request) => request.hadTimeLimit), "a request had no time limit");
    assert.ok(result.kind === "authorized");
    assert.deepEqual(result.accounts, [
      {
        externalAccountId: "abc123",
        displayName: "Ana Baker",
        accountKind: "member",
        scopes: ["openid", "profile", "w_member_social"],
        accessToken: `li-access-${runId}`,
        refreshToken: null,
        accessExpiresAt: new Date(now.getTime() + 5184000 * 1000),
        refreshExpiresAt: null,
      },
    ]);
    // LinkedIn refusing the code, or a member id that isn't one.
    for (const answers of [[json({ error: "invalid_request" }, 401)], [json({ access_token: "t", expires_in: 1 }), json({ sub: "has spaces" })]]) {
      const refused = await linkedInAdapter.completeAuthorization({ code: "c", redirectUri: REDIRECT, codeVerifier: null }, contextFor("linkedin", fakePlatform(answers).fetchFn));
      assert.deepEqual(refused, { kind: "failed", code: "exchange_failed" });
    }
  });

  await check("linkedin: a text post and an image post are the Posts and Images API requests LinkedIn documents (version 202610, Rest.li 2.0.0); its reserved characters are escaped and hashtags kept as LinkedIn's template", async () => {
    const target = { externalAccountId: "abc123", accessToken: "member-token" };
    const restHeaders = { authorization: "Bearer member-token", "linkedin-version": "202610", "x-restli-protocol-version": "2.0.0", "content-type": "application/json" };
    const text = fakePlatform([posted("urn:li:share:7000000000000000001")]);
    const result = await linkedInAdapter.publish(target, textPost("Fresh bread (today) #sourdough"), contextFor("linkedin", text.fetchFn));
    assert.deepEqual(result, { kind: "published", externalPostId: "urn:li:share:7000000000000000001", url: "https://www.linkedin.com/feed/update/urn:li:share:7000000000000000001/" });
    const [postRequest] = text.requests;
    assert.deepEqual([postRequest.method, postRequest.url], ["POST", "https://api.linkedin.com/rest/posts"]);
    assert.deepEqual(postRequest.headers, restHeaders);
    assert.deepEqual(JSON.parse(String(postRequest.body)), {
      author: "urn:li:person:abc123",
      commentary: "Fresh bread \\(today\\) {hashtag|\\#|sourdough}",
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    });
    const uploadUrl = "https://www.linkedin.com/dms-uploads/C4E10AQ/uploaded-image/0?ca=vector_ads&cn=uploads";
    const image = fakePlatform([json({ value: { uploadUrlExpiresAt: 1650567510704, uploadUrl, image: "urn:li:image:C4E10AQF" } }), new Response(null, { status: 201 }), posted("urn:li:ugcPost:7000000000000000002")]);
    const withImage = await linkedInAdapter.publish(target, imagePost("Look"), contextFor("linkedin", image.fetchFn));
    assert.equal(withImage.kind, "published");
    const [initialize, upload, post] = image.requests;
    assert.deepEqual([initialize.method, initialize.url, initialize.headers], ["POST", "https://api.linkedin.com/rest/images?action=initializeUpload", restHeaders]);
    assert.deepEqual(JSON.parse(String(initialize.body)), { initializeUploadRequest: { owner: "urn:li:person:abc123" } });
    assert.deepEqual([upload.method, upload.url, upload.headers], ["PUT", uploadUrl, { authorization: "Bearer member-token", "content-type": "image/png" }]);
    assert.ok(Buffer.from(upload.body as Uint8Array).equals(PNG), "the image's bytes were not sent as they are");
    assert.deepEqual(JSON.parse(String(post.body)).content, { media: { id: "urn:li:image:C4E10AQF", altText: "Three loaves" } });
    assert.equal(toLinkedInLittleText("a_b *c* [d] {e} @f <g> ~h | \\i #1 #ok C# #x_y"), "a\\_b \\*c\\* \\[d\\] \\{e\\} \\@f \\<g\\> \\~h \\| \\\\i \\#1 {hashtag|\\#|ok} C\\# {hashtag|\\#|x\\_y}");
  });

  await check("linkedin: 422 duplicate, 400, 401, 403, 409 and 429 (with its wait) created nothing; 500, 503, a 201 without the post's id and no answer are unclear; an upload address off LinkedIn gets nothing, a video or WebP no request at all", async () => {
    const target = { externalAccountId: "abc123", accessToken: "member-token" };
    const cases: [Response, unknown][] = [
      [json({ message: "Content is a duplicate of urn:li:share:123", status: 422 }, 422), { kind: "not_created", code: "duplicate" }],
      [json({ message: "Field value is invalid", status: 422 }, 422), { kind: "not_created", code: "unprocessable" }],
      [json({ status: 400 }, 400), { kind: "not_created", code: "invalid_request" }],
      [json({ status: 401 }, 401), { kind: "not_created", code: "token_rejected" }],
      [json({ status: 403 }, 403), { kind: "not_created", code: "permission_denied" }],
      [json({ status: 409 }, 409), { kind: "not_created", code: "conflict" }],
      [json({ status: 429 }, 429, { "retry-after": "120" }), { kind: "not_created", code: "rate_limited", retryAfterSeconds: 120 }],
      [json({ status: 500 }, 500), { kind: "unclear", code: "server_error" }],
      [json({ status: 503 }, 503), { kind: "unclear", code: "server_error" }],
      [new Response(null, { status: 201 }), { kind: "unclear", code: "no_post_id" }],
    ];
    for (const [answer, expected] of cases) {
      assert.deepEqual(await linkedInAdapter.publish(target, textPost("Hi"), contextFor("linkedin", fakePlatform([answer]).fetchFn)), expected, `${answer.status}`);
    }
    const unreachable = async () => {
      throw new TypeError(`fetch failed for member-token`);
    };
    assert.deepEqual(await linkedInAdapter.publish(target, textPost("Hi"), contextFor("linkedin", unreachable)), { kind: "unclear", code: "network_error" });
    const elsewhere = fakePlatform([json({ value: { uploadUrl: "https://uploads.evil.test/put", image: "urn:li:image:X1" } })]);
    assert.deepEqual(await linkedInAdapter.publish(target, imagePost("Hi"), contextFor("linkedin", elsewhere.fetchFn)), { kind: "not_created", code: "upload_url_refused" });
    assert.equal(elsewhere.requests.length, 1, "the token went to another host");
    const none = fakePlatform([]);
    const video: SocialPost = { text: "Hi", title: "", media: { kind: "video", contentType: "video/mp4", bytes: Buffer.alloc(10), altText: "" } };
    assert.deepEqual(await linkedInAdapter.publish(target, video, contextFor("linkedin", none.fetchFn)), { kind: "not_created", code: "video_not_supported" });
    assert.deepEqual(await linkedInAdapter.publish(target, imagePost("Hi", WEBP, "image/webp"), contextFor("linkedin", none.fetchFn)), { kind: "not_created", code: "media_type_not_accepted" });
    assert.equal(none.requests.length, 0);
    // A failed image step created nothing: no post is asked for.
    const failedUpload = fakePlatform([json({ value: { uploadUrl: "https://www.linkedin.com/dms-uploads/x", image: "urn:li:image:X2" } }), new Response(null, { status: 500 })]);
    assert.deepEqual(await linkedInAdapter.publish(target, imagePost("Hi"), contextFor("linkedin", failedUpload.fetchFn)), { kind: "not_created", code: "upload_failed" });
    assert.equal(failedUpload.requests.length, 2);
  });

  await check("facebook: the login dialog, the code exchange, the long-lived token, the permissions and the Pages are the Graph API v26.0 requests Meta documents, each later call with appsecret_proof", async () => {
    const authorize = new URL(facebookAdapter.buildAuthorizeUrl({ clientId: "app-id", redirectUri: REDIRECT, state: "the-state", codeChallenge: null }));
    assert.equal(`${authorize.origin}${authorize.pathname}`, "https://www.facebook.com/v26.0/dialog/oauth");
    assert.deepEqual(Object.fromEntries(authorize.searchParams), { client_id: "app-id", redirect_uri: REDIRECT, state: "the-state", response_type: "code", scope: "pages_show_list,pages_read_engagement,pages_manage_posts" });
    const platform = fakePlatform(facebookConnects([{ id: "111", name: "Ansa Bakery", tasks: ["CREATE_CONTENT"] }]));
    const result = await facebookAdapter.completeAuthorization({ code: "the-code", redirectUri: REDIRECT, codeVerifier: null }, contextFor("facebook", platform.fetchFn));
    assert.ok(result.kind === "authorized" && result.accounts.length === 1 && result.accounts[0].accessToken === `fb-page-111-${runId}`);
    const secret = fakeCredentials("facebook").clientSecret;
    const proof = createHmac("sha256", secret).update(`fb-long-${runId}`).digest("hex");
    const asked = platform.requests.map((request) => [request.method, new URL(request.url).origin + new URL(request.url).pathname, Object.fromEntries(new URL(request.url).searchParams)]);
    assert.deepEqual(asked, [
      ["GET", "https://graph.facebook.com/v26.0/oauth/access_token", { client_id: `client-facebook-${runId}`, redirect_uri: REDIRECT, client_secret: secret, code: "the-code" }],
      ["GET", "https://graph.facebook.com/v26.0/oauth/access_token", { grant_type: "fb_exchange_token", client_id: `client-facebook-${runId}`, client_secret: secret, fb_exchange_token: `fb-short-${runId}` }],
      ["GET", "https://graph.facebook.com/v26.0/me/permissions", { access_token: `fb-long-${runId}`, appsecret_proof: proof }],
      ["GET", "https://graph.facebook.com/v26.0/me/accounts", { fields: "id,name,access_token,tasks", limit: "100", access_token: `fb-long-${runId}`, appsecret_proof: proof }],
    ]);
    assert.ok(platform.requests.every((request) => request.hadTimeLimit));
  });

  await check("facebook: a text post goes to the Page's /feed and a photo to its /photos (source, caption, alt text), with the Page's token and appsecret_proof; error codes map as Meta documents them", async () => {
    const target = { externalAccountId: "111", accessToken: "page-token" };
    const proof = createHmac("sha256", fakeCredentials("facebook").clientSecret).update("page-token").digest("hex");
    const feed = fakePlatform([json({ id: "111_222" })]);
    assert.deepEqual(await facebookAdapter.publish(target, textPost("Fresh bread"), contextFor("facebook", feed.fetchFn)), { kind: "published", externalPostId: "111_222", url: "https://www.facebook.com/111_222" });
    assert.deepEqual([feed.requests[0].method, feed.requests[0].url, feed.requests[0].headers["content-type"]], ["POST", "https://graph.facebook.com/v26.0/111/feed", "application/x-www-form-urlencoded"]);
    assert.deepEqual(formOf(feed.requests[0].body), { message: "Fresh bread", access_token: "page-token", appsecret_proof: proof });
    const photos = fakePlatform([json({ id: "999", post_id: "111_333" })]);
    assert.deepEqual(await facebookAdapter.publish(target, imagePost("Look"), contextFor("facebook", photos.fetchFn)), { kind: "published", externalPostId: "111_333", url: "https://www.facebook.com/111_333" });
    const form = photos.requests[0].body as FormData;
    assert.deepEqual([photos.requests[0].method, photos.requests[0].url], ["POST", "https://graph.facebook.com/v26.0/111/photos"]);
    assert.deepEqual([form.get("caption"), form.get("published"), form.get("alt_text_custom"), form.get("access_token"), form.get("appsecret_proof")], ["Look", "true", "Three loaves", "page-token", proof]);
    const source = form.get("source") as Blob;
    assert.ok(Buffer.from(await source.arrayBuffer()).equals(PNG) && source.type === "image/png", "the photo's bytes were not sent as they are");
    const graphError = (code: number, status = 400, headers: Record<string, string> = {}) => json({ error: { message: `secret ${runId}`, type: "OAuthException", code, fbtrace_id: "x" } }, status, headers);
    const cases: [Response, unknown][] = [
      [graphError(506), { kind: "not_created", code: "duplicate" }],
      [graphError(4, 400, { "x-business-use-case-usage": JSON.stringify({ "111": [{ type: "pages", estimated_time_to_regain_access: 5 }] }) }), { kind: "not_created", code: "rate_limited", retryAfterSeconds: 300 }],
      [graphError(32), { kind: "not_created", code: "rate_limited" }],
      [graphError(80001), { kind: "not_created", code: "rate_limited" }],
      [graphError(190, 401), { kind: "not_created", code: "token_rejected" }],
      [graphError(200, 403), { kind: "not_created", code: "permission_denied" }],
      [graphError(10, 403), { kind: "not_created", code: "permission_denied" }],
      [graphError(368), { kind: "not_created", code: "blocked_by_policy" }],
      [graphError(100), { kind: "not_created", code: "invalid_request" }],
      [graphError(1609005), { kind: "not_created", code: "link_error" }],
      [graphError(1, 500), { kind: "unclear", code: "temporary_error" }],
      [graphError(2, 503), { kind: "unclear", code: "temporary_error" }],
      [new Response(null, { status: 502 }), { kind: "unclear", code: "server_error" }],
      [graphError(9999), { kind: "unclear", code: "unexpected_answer" }],
      [json({ success: true }), { kind: "unclear", code: "no_post_id" }],
    ];
    for (const [answer, expected] of cases) {
      assert.deepEqual(await facebookAdapter.publish(target, textPost("Hi"), contextFor("facebook", fakePlatform([answer]).fetchFn)), expected, `${answer.status}`);
    }
    const none = fakePlatform([]);
    assert.deepEqual(await facebookAdapter.publish(target, imagePost("Hi", WEBP, "image/webp"), contextFor("facebook", none.fetchFn)), { kind: "not_created", code: "media_type_not_accepted" });
    assert.deepEqual(await facebookAdapter.publish(target, imagePost("Hi", Buffer.alloc(10 * 1024 * 1024 + 1)), contextFor("facebook", none.fetchFn)), { kind: "not_created", code: "media_too_large" });
    assert.equal(none.requests.length, 0);
  });
}
