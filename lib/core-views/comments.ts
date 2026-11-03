import "server-only";
import { callCore } from "@/lib/core-api";
import { asFormResult } from "@/lib/core-views/ticket-actions";
import type { FormResult } from "@/lib/form-result";
import type { CommentOutcome, CommentsPage, CommentsSettings, PracticeCommentRead, PracticeCommentSent, PracticePost } from "@/lib/types/comments";

// Comments on the business's Facebook Page posts through core
// (/api/v1/comments): the Inbox's Comments page, its Send and Discard, the
// switch on Settings → Connections, and the practice comment (development,
// owners: core refuses it anywhere else).

// Said next to Send or Discard when someone else (or ansa) got there first:
// the page, refreshed, shows what became of it.
const NO_LONGER_WAITING = "This reply isn't waiting any more: the comment shows what happened to it.";

// One page of the company's comments, newest first, and whether ansa answers comments now.
export async function getCommentsFromCore(page: number): Promise<CommentsPage> {
  const answer = await callCore<CommentsPage>("GET", `/api/v1/comments?${new URLSearchParams({ page: String(page) })}`);
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  return answer.data;
}

// "Send": ansa's waiting texts for this comment go out as written.
export async function sendCommentReplyThroughCore(commentId: string): Promise<FormResult> {
  return answerWaitingReply(commentId, "send");
}

// "Discard": ansa's waiting texts for this comment never go out.
export async function discardCommentReplyThroughCore(commentId: string): Promise<FormResult> {
  return answerWaitingReply(commentId, "discard");
}

// The id is only a claim from a form: core checks it is the session's company's.
async function answerWaitingReply(commentId: string, action: "send" | "discard"): Promise<FormResult> {
  const answer = await callCore<{ outcome: CommentOutcome }>("POST", `/api/v1/comments/${encodeURIComponent(commentId)}/${action}`, {});
  if (!answer.ok) {
    return asFormResult(answer);
  }
  return answer.data.outcome === "changed" ? { ok: false, errors: { message: NO_LONGER_WAITING } } : { ok: true };
}

// Whether ansa answers comments, and the Pages it would answer them on.
// null when core couldn't say: Connections then leaves the comments part
// out instead of failing the whole page.
export async function getCommentSettingsFromCore(): Promise<CommentsSettings | null> {
  const answer = await callCore<CommentsSettings>("GET", "/api/v1/comments/settings");
  return answer.ok ? answer.data : null;
}

// Owners switch answering comments on or off (core refuses members).
export async function saveCommentSettingsThroughCore(on: boolean): Promise<FormResult> {
  return asFormResult(await callCore<{ outcome: "saved" }>("POST", "/api/v1/comments/settings", { on }));
}

// The stand-in Page's posts a practice comment can go under ([] when core refuses).
export async function getPracticeCommentPostsFromCore(): Promise<PracticePost[]> {
  const answer = await callCore<{ posts: PracticePost[] }>("GET", "/api/v1/practice/comment/posts");
  return answer.ok ? answer.data.posts : [];
}

// A made-up person's comment under one of those posts: its id, to follow what ansa does with it.
export async function sendPracticeCommentThroughCore(comment: { postId: string; name: string; text: string }): Promise<PracticeCommentSent> {
  const answer = await callCore<{ commentId: string }>("POST", "/api/v1/practice/comment", comment);
  if (!answer.ok) {
    return { ok: false, error: answer.fields.text ?? answer.fields.name ?? answer.fields.postId ?? answer.message };
  }
  return { ok: true, commentId: answer.data.commentId };
}

// The practice comment as the Comments page shows it, and whether ansa is
// still on it (null: it couldn't be read).
export async function readPracticeCommentFromCore(commentId: string): Promise<PracticeCommentRead | null> {
  const answer = await callCore<PracticeCommentRead>("GET", `/api/v1/practice/comment/${encodeURIComponent(commentId)}`);
  return answer.ok ? answer.data : null;
}
