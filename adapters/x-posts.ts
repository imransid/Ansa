import "server-only";
import { z } from "zod";
import type { PublishErrorCode } from "@/lib/social-errors";
import { API_TIMEOUT_MS, discardAnswer, IMAGE_UPLOAD_TIMEOUT_MS, notCreated, readJsonAnswer, readJsonIfOk, secondsUntilEpochSeconds, sendToPlatform, unclear } from "@/lib/social-http";
import type { AdapterContext, PublishResult, PublishTarget, SocialMedia, SocialPost } from "@/lib/social-types";

// X's half of publishing (adapters/x.ts holds the rest): POST /2/tweets,
// with an image sent first through the v2 media upload (docs/research/
// social-publishing-apis.md, section 4). NOT TESTED against X. Videos and
// GIFs need X's chunked upload (initialize, append, finalize, status): not
// built yet. X takes up to 4 images; a draft holds one.

const TWEETS_URL = "https://api.x.com/2/tweets";
const MEDIA_UPLOAD_URL = "https://api.x.com/2/media/upload";
// Images: JPG, PNG, GIF and WEBP, at most 5 MB.
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const uploadedSchema = z.object({ data: z.object({ id: z.string().regex(/^\d{1,30}$/) }) });
const createdSchema = z.object({ data: z.object({ id: z.string().regex(/^\d{1,30}$/) }).optional() });

// docs.x.com's response codes: these created nothing.
const NOT_CREATED_BY_STATUS: Record<number, PublishErrorCode> = {
  400: "invalid_request",
  401: "token_rejected",
  403: "permission_denied",
  404: "not_found",
};

// One post: its image first (when there is one), then the post.
export async function publishXPost(target: PublishTarget, post: SocialPost, context: AdapterContext): Promise<PublishResult> {
  if (post.media?.kind === "video") {
    return notCreated("video_not_supported");
  }
  let mediaId: string | null = null;
  if (post.media) {
    const uploaded = await uploadImage(target, post.media, context);
    if (typeof uploaded !== "string") {
      return uploaded;
    }
    mediaId = uploaded;
  }
  const body = JSON.stringify({ text: post.text, ...(mediaId ? { media: { media_ids: [mediaId] } } : {}) });
  const headers = { Authorization: `Bearer ${target.accessToken}`, "Content-Type": "application/json" };
  const answer = await sendToPlatform(context.fetchFn, TWEETS_URL, { method: "POST", headers, body }, API_TIMEOUT_MS);
  if (answer.kind === "no_answer") {
    return unclear(answer.code);
  }
  if (!answer.response.ok) {
    await discardAnswer(answer.response);
    return refusal(answer.response, context);
  }
  // 201 with data.id; a 200 with an errors array is a partial success.
  const created = await readJsonAnswer(answer.response, createdSchema);
  if (!created?.data) {
    return unclear("no_post_id");
  }
  return { kind: "published", externalPostId: created.data.id, url: `https://x.com/i/web/status/${created.data.id}` };
}

// The simple v2 upload (multipart: the bytes and media_category): its media
// id for the post, or why nothing was posted. Nothing is posted yet here.
async function uploadImage(target: PublishTarget, media: SocialMedia, context: AdapterContext): Promise<string | PublishResult> {
  if (!IMAGE_TYPES.includes(media.contentType)) {
    return notCreated("media_type_not_accepted");
  }
  if (media.bytes.length > MAX_IMAGE_BYTES) {
    return notCreated("media_too_large");
  }
  const form = new FormData();
  form.set("media", new Blob([new Uint8Array(media.bytes)], { type: media.contentType }), "image");
  form.set("media_category", "tweet_image");
  const init = { method: "POST", headers: { Authorization: `Bearer ${target.accessToken}` }, body: form };
  const answer = await sendToPlatform(context.fetchFn, MEDIA_UPLOAD_URL, init, IMAGE_UPLOAD_TIMEOUT_MS);
  if (answer.kind === "answered" && (answer.response.status === 401 || answer.response.status === 429)) {
    await discardAnswer(answer.response);
    return refusal(answer.response, context);
  }
  const uploaded = await readJsonIfOk(answer, uploadedSchema);
  return uploaded ? uploaded.data.id : notCreated("upload_failed");
}

// 400, 401, 403, 404 and 429 created nothing; 500, 502, 503 and 504 (and
// anything else) may have.
function refusal(response: Response, context: AdapterContext): PublishResult {
  const status = response.status;
  if (NOT_CREATED_BY_STATUS[status]) {
    return notCreated(NOT_CREATED_BY_STATUS[status]);
  }
  if (status === 429) {
    // x-rate-limit-reset: when the window ends, in seconds since 1970.
    return notCreated("rate_limited", secondsUntilEpochSeconds(response.headers.get("x-rate-limit-reset"), context.now));
  }
  return unclear(status >= 500 ? "server_error" : "unexpected_answer");
}
