import "server-only";
import { z } from "zod";
import { isAllowedHostUrl } from "@/lib/allowed-host-download";
import type { PublishErrorCode } from "@/lib/social-errors";
import { API_TIMEOUT_MS, discardAnswer, notCreated, readJsonAnswer, sendToPlatform, unclear } from "@/lib/social-http";
import type { AdapterContext, PublishResult, PublishTarget, SocialMedia, SocialPost } from "@/lib/social-types";

// YouTube's half of publishing (adapters/youtube.ts holds the rest): one
// video through the resumable videos.insert (docs/research/
// social-publishing-apis.md, section 3, and Google's "Resumable uploads"
// guide): a POST starts a session and names its address in Location, a PUT
// sends the bytes. No video exists before the bytes arrive, so every
// failure up to the PUT created nothing. NOT TESTED against YouTube. Each
// upload costs one of the 100 a day ansa's whole Google project gets.

const UPLOAD_START_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
// Where a session address may point: the channel's token goes with the bytes.
const SESSION_HOSTS = ["www.googleapis.com"];
// Sending the whole video (the media library keeps files up to 100 MB).
export const VIDEO_UPLOAD_TIMEOUT_MS = 180_000;
// After these the upload may have finished: Google says to resume the same session.
const RESUMABLE_STATUSES = [500, 502, 503, 504];

const videoSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,30}$/) });

// Only the reasons Google lists are read, never its message.
const googleErrorSchema = z.object({ error: z.object({ errors: z.array(z.object({ reason: z.string().max(100).optional() })).max(20).optional() }) });

// One video, with its title and description (the post's text).
export async function publishYouTubeVideo(target: PublishTarget, post: SocialPost, context: AdapterContext): Promise<PublishResult> {
  if (post.media?.kind !== "video") {
    return notCreated("text_posts_not_supported");
  }
  if (!post.title.trim()) {
    return notCreated("title_missing");
  }
  const sessionUrl = await startUploadSession(target, post, post.media, context);
  if (typeof sessionUrl !== "string") {
    return sessionUrl;
  }
  const upload = { method: "PUT", headers: { Authorization: `Bearer ${target.accessToken}`, "Content-Type": post.media.contentType }, body: new Uint8Array(post.media.bytes) };
  const answer = await sendToPlatform(context.fetchFn, sessionUrl, upload, VIDEO_UPLOAD_TIMEOUT_MS);
  if (answer.kind === "no_answer") {
    return unclear(answer.code === "timeout" ? "timeout" : "upload_interrupted");
  }
  if (answer.response.ok) {
    const video = await readJsonAnswer(answer.response, videoSchema);
    return video ? { kind: "published", externalPostId: video.id, url: `https://www.youtube.com/watch?v=${video.id}` } : unclear("no_post_id");
  }
  if (RESUMABLE_STATUSES.includes(answer.response.status)) {
    await discardAnswer(answer.response);
    return unclear("upload_interrupted");
  }
  // 404: the session expired. Any other answer "failed permanently".
  if (answer.response.status === 404) {
    await discardAnswer(answer.response);
    return notCreated("upload_session_expired");
  }
  return refusal(answer.response);
}

// POST with the video's details: the session's address, or why nothing was made.
async function startUploadSession(target: PublishTarget, post: SocialPost, media: SocialMedia, context: AdapterContext): Promise<string | PublishResult> {
  const headers = {
    Authorization: `Bearer ${target.accessToken}`,
    "Content-Type": "application/json; charset=UTF-8",
    "X-Upload-Content-Length": String(media.bytes.length),
    "X-Upload-Content-Type": media.contentType,
  };
  const body = JSON.stringify({ snippet: { title: post.title.trim(), description: post.text }, status: { privacyStatus: "public" } });
  const answer = await sendToPlatform(context.fetchFn, UPLOAD_START_URL, { method: "POST", headers, body }, API_TIMEOUT_MS);
  if (answer.kind === "no_answer") {
    return notCreated("upload_failed");
  }
  if (!answer.response.ok) {
    return refusal(answer.response);
  }
  await discardAnswer(answer.response);
  const location = answer.response.headers.get("location") ?? "";
  return isAllowedHostUrl(location, SESSION_HOSTS) ? location : notCreated("upload_url_refused");
}

// A refusal that created nothing, named by Google's reason when it gives one.
async function refusal(response: Response): Promise<PublishResult> {
  const error = await readJsonAnswer(response, googleErrorSchema);
  const reasons = (error?.error.errors ?? []).map((entry) => entry.reason ?? "");
  return notCreated(refusalCode(response.status, reasons));
}

// quotaExceeded and uploadLimitExceeded: the day's uploads are used up
// (ansa's whole project shares them); rateLimitExceeded: too fast.
function refusalCode(status: number, reasons: string[]): PublishErrorCode {
  if (status === 401) {
    return "token_rejected";
  }
  if (reasons.includes("quotaExceeded") || reasons.includes("uploadLimitExceeded")) {
    return "quota_exceeded";
  }
  if (reasons.includes("rateLimitExceeded")) {
    return "rate_limited";
  }
  if (status === 403) {
    return "permission_denied";
  }
  return status === 400 ? "invalid_request" : "upload_failed";
}
