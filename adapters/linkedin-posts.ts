import "server-only";
import { z } from "zod";
import { isAllowedHostUrl } from "@/lib/allowed-host-download";
import { toLinkedInLittleText } from "@/lib/linkedin-text";
import type { PublishErrorCode } from "@/lib/social-errors";
import { API_TIMEOUT_MS, discardAnswer, IMAGE_UPLOAD_TIMEOUT_MS, notCreated, readJsonAnswer, readJsonIfOk, secondsFromRetryAfter, sendToPlatform, unclear } from "@/lib/social-http";
import type { AdapterContext, PublishResult, PublishTarget, SocialMedia, SocialPost } from "@/lib/social-types";

// LinkedIn's half of publishing (adapters/linkedin.ts holds the rest): a
// member post through the Posts API, an image first through the Images API
// (docs/research/social-publishing-apis.md, section 1). NOT TESTED against
// LinkedIn. Videos need its multi-part Videos API: not built yet.

const POSTS_URL = "https://api.linkedin.com/rest/posts";
const INITIALIZE_IMAGE_URL = "https://api.linkedin.com/rest/images?action=initializeUpload";
// Every /rest call names the API version (YYYYMM: each is supported for at
// least a year, and a missing or ended one is refused; 202511 ends on
// 2026-11-16) and the Rest.li protocol version.
export const LINKEDIN_VERSION = "202610";
// The Images API takes JPG, GIF and PNG.
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif"];
// Where an upload URL may point (LinkedIn's answers show www.linkedin.com):
// the member's token goes with the image, so never anywhere else.
const UPLOAD_HOSTS = ["www.linkedin.com", "api.linkedin.com"];

const initializedImageSchema = z.object({
  value: z.object({ uploadUrl: z.string().url(), image: z.string().regex(/^urn:li:image:[A-Za-z0-9_-]{1,200}$/) }),
});

const errorMessageSchema = z.object({ message: z.string().max(10_000).optional() });

// The Posts API's error table: these created nothing (409: "retry").
const NOT_CREATED_BY_STATUS: Record<number, PublishErrorCode> = {
  400: "invalid_request",
  401: "token_rejected",
  403: "permission_denied",
  404: "not_found",
  409: "conflict",
};

// One member post: the image first (when there is one), then the post.
export async function publishLinkedInPost(target: PublishTarget, post: SocialPost, context: AdapterContext): Promise<PublishResult> {
  if (post.media?.kind === "video") {
    return notCreated("video_not_supported");
  }
  let imageUrn: string | null = null;
  if (post.media) {
    const uploaded = await uploadImage(target, post.media, context);
    if (typeof uploaded !== "string") {
      return uploaded;
    }
    imageUrn = uploaded;
  }
  return createPost(target, post, imageUrn, context);
}

// The headers every /rest call carries.
function restHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}`, "Linkedin-Version": LINKEDIN_VERSION, "X-Restli-Protocol-Version": "2.0.0", "Content-Type": "application/json" };
}

// Registers the image with the Images API, then sends its bytes: the image's
// URN for the post, or why nothing was posted. Nothing is posted yet at
// this stage, so every failure here is "not created".
async function uploadImage(target: PublishTarget, media: SocialMedia, context: AdapterContext): Promise<string | PublishResult> {
  if (!IMAGE_TYPES.includes(media.contentType)) {
    return notCreated("media_type_not_accepted");
  }
  const body = JSON.stringify({ initializeUploadRequest: { owner: `urn:li:person:${target.externalAccountId}` } });
  const initialized = await sendToPlatform(context.fetchFn, INITIALIZE_IMAGE_URL, { method: "POST", headers: restHeaders(target.accessToken), body }, API_TIMEOUT_MS);
  if (initialized.kind === "answered" && (initialized.response.status === 401 || initialized.response.status === 429)) {
    await discardAnswer(initialized.response);
    const retryAfter = secondsFromRetryAfter(initialized.response.headers.get("retry-after"), context.now);
    return initialized.response.status === 401 ? notCreated("token_rejected") : notCreated("rate_limited", retryAfter);
  }
  const registered = await readJsonIfOk(initialized, initializedImageSchema);
  if (!registered) {
    return notCreated("upload_failed");
  }
  if (!isAllowedHostUrl(registered.value.uploadUrl, UPLOAD_HOSTS)) {
    return notCreated("upload_url_refused");
  }
  const upload = { method: "PUT", headers: { Authorization: `Bearer ${target.accessToken}`, "Content-Type": media.contentType }, body: new Uint8Array(media.bytes) };
  const sent = await sendToPlatform(context.fetchFn, registered.value.uploadUrl, upload, IMAGE_UPLOAD_TIMEOUT_MS);
  if (sent.kind === "answered") {
    await discardAnswer(sent.response);
  }
  return sent.kind === "answered" && sent.response.ok ? registered.value.image : notCreated("upload_failed");
}

// The post itself: 201 with its id in the x-restli-id header.
async function createPost(target: PublishTarget, post: SocialPost, imageUrn: string | null, context: AdapterContext): Promise<PublishResult> {
  const media = imageUrn ? { id: imageUrn, ...(post.media?.altText ? { altText: post.media.altText } : {}) } : null;
  const body = JSON.stringify({
    author: `urn:li:person:${target.externalAccountId}`,
    commentary: toLinkedInLittleText(post.text),
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    ...(media ? { content: { media } } : {}),
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  });
  const answer = await sendToPlatform(context.fetchFn, POSTS_URL, { method: "POST", headers: restHeaders(target.accessToken), body }, API_TIMEOUT_MS);
  if (answer.kind === "no_answer") {
    return unclear(answer.code);
  }
  if (answer.response.status !== 201) {
    return postRefusal(answer.response, context);
  }
  await discardAnswer(answer.response);
  const postId = answer.response.headers.get("x-restli-id") ?? "";
  // Created, but without its id nobody could tell which post it is.
  if (!/^urn:li:(share|ugcPost):\d{1,30}$/.test(postId)) {
    return unclear("no_post_id");
  }
  return { kind: "published", externalPostId: postId, url: `https://www.linkedin.com/feed/update/${postId}/` };
}

// 400, 401, 403, 404, 409, 422 and 429 created nothing; a 5xx (or anything
// else) may have (docs/research/social-publishing-apis.md, "Duplicates and
// retry safety").
async function postRefusal(response: Response, context: AdapterContext): Promise<PublishResult> {
  const status = response.status;
  if (status === 422) {
    // Read only to tell a duplicate apart; the message is never kept or logged.
    const error = await readJsonAnswer(response, errorMessageSchema);
    return notCreated(/duplicate/i.test(error?.message ?? "") ? "duplicate" : "unprocessable");
  }
  await discardAnswer(response);
  if (NOT_CREATED_BY_STATUS[status]) {
    return notCreated(NOT_CREATED_BY_STATUS[status]);
  }
  if (status === 429) {
    return notCreated("rate_limited", secondsFromRetryAfter(response.headers.get("retry-after"), context.now));
  }
  return unclear(status >= 500 ? "server_error" : "unexpected_answer");
}
