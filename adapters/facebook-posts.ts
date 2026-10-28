import "server-only";
import { z } from "zod";
import type { PublishErrorCode } from "@/lib/social-errors";
import { API_TIMEOUT_MS, IMAGE_UPLOAD_TIMEOUT_MS, notCreated, readJsonAnswer, sendToPlatform, unclear, type PlatformAnswer } from "@/lib/social-http";
import type { AdapterContext, PublishResult, PublishTarget, SocialPost } from "@/lib/social-types";
import { appSecretProof, GRAPH_URL, graphErrorSchema, THROTTLED_CODES } from "./facebook-graph";

// Facebook's half of publishing (adapters/facebook.ts holds the rest): a
// text post to a Page's /feed, or a photo to its /photos, which posts it
// with its caption (docs/research/social-publishing-apis.md, section 2).
// Each call creates the post itself, so a 5xx or a cut-off answer is
// unclear. NOT TESTED against Facebook. Videos need Meta's resumable
// upload: not built yet.

// The /photos reference: jpeg, bmp, png, gif and tiff, at most 10 MB (the
// media library holds no bmp or tiff).
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/gif"];
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const createdSchema = z.object({ id: z.string().regex(/^[\d_]{1,60}$/), post_id: z.string().regex(/^[\d_]{1,60}$/).optional() });

// The usage header's wait, in minutes, per business the token touches.
const usageSchema = z.record(z.string(), z.array(z.object({ estimated_time_to_regain_access: z.number().nonnegative().optional() })));

// The error-handling guide's codes that mean nothing was created (besides throttling).
const NOT_CREATED_BY_CODE: Record<number, PublishErrorCode> = {
  506: "duplicate",
  190: "token_rejected",
  10: "permission_denied",
  368: "blocked_by_policy",
  100: "invalid_request",
  1609005: "link_error",
};

// One Page post: a photo with its caption, or the text alone.
export async function publishFacebookPost(target: PublishTarget, post: SocialPost, context: AdapterContext): Promise<PublishResult> {
  if (post.media?.kind === "video") {
    return notCreated("video_not_supported");
  }
  const proof = appSecretProof(target.accessToken, context.credentials.clientSecret);
  if (!post.media) {
    const body = new URLSearchParams({ message: post.text, access_token: target.accessToken, appsecret_proof: proof }).toString();
    const init = { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body };
    return readCreated(await sendToPlatform(context.fetchFn, `${GRAPH_URL}/${target.externalAccountId}/feed`, init, API_TIMEOUT_MS));
  }
  if (!PHOTO_TYPES.includes(post.media.contentType)) {
    return notCreated("media_type_not_accepted");
  }
  if (post.media.bytes.length > MAX_PHOTO_BYTES) {
    return notCreated("media_too_large");
  }
  const form = new FormData();
  form.set("source", new Blob([new Uint8Array(post.media.bytes)], { type: post.media.contentType }), "image");
  form.set("caption", post.text);
  form.set("published", "true");
  if (post.media.altText) {
    form.set("alt_text_custom", post.media.altText);
  }
  form.set("access_token", target.accessToken);
  form.set("appsecret_proof", proof);
  const answer = await sendToPlatform(context.fetchFn, `${GRAPH_URL}/${target.externalAccountId}/photos`, { method: "POST", body: form }, IMAGE_UPLOAD_TIMEOUT_MS);
  return readCreated(answer);
}

// The new post's id (a photo's post_id is its post), or what the error means.
async function readCreated(answer: PlatformAnswer): Promise<PublishResult> {
  if (answer.kind === "no_answer") {
    return unclear(answer.code);
  }
  if (answer.response.ok) {
    const created = await readJsonAnswer(answer.response, createdSchema);
    // A 200 without an id: it may well be up, but there's nothing to point at.
    return created ? published(created.post_id ?? created.id) : unclear("no_post_id");
  }
  const error = await readJsonAnswer(answer.response, graphErrorSchema);
  return refusal(answer.response, error?.error.code ?? null);
}

function published(postId: string): PublishResult {
  return { kind: "published", externalPostId: postId, url: `https://www.facebook.com/${postId}` };
}

// What a Graph error means (docs/research/social-publishing-apis.md,
// "Duplicates and retry safety"): the listed codes created nothing; 1 and
// 2 are temporary and unclear; anything else, a 5xx included, is unclear.
function refusal(response: Response, code: number | null): PublishResult {
  if (code !== null && THROTTLED_CODES.includes(code)) {
    return notCreated("rate_limited", secondsToRegainAccess(response));
  }
  if (code !== null && NOT_CREATED_BY_CODE[code]) {
    return notCreated(NOT_CREATED_BY_CODE[code]);
  }
  if (code !== null && code >= 200 && code <= 299) {
    return notCreated("permission_denied");
  }
  if (code === 1 || code === 2) {
    return unclear("temporary_error");
  }
  return unclear(response.status >= 500 ? "server_error" : "unexpected_answer");
}

// Meta's X-Business-Use-Case-Usage header says, per business, how many
// minutes until calls work again; the longest wait, in seconds.
function secondsToRegainAccess(response: Response): number | undefined {
  try {
    const usage = usageSchema.safeParse(JSON.parse(response.headers.get("x-business-use-case-usage") ?? "null"));
    const minutes = usage.success ? Object.values(usage.data).flat().map((entry) => entry.estimated_time_to_regain_access ?? 0) : [];
    const longest = Math.max(0, ...minutes);
    return longest > 0 ? longest * 60 : undefined;
  } catch {
    return undefined;
  }
}
