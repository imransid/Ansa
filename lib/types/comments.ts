// Comments on a business's Facebook Page posts, as core gives them
// (core's /api/v1/comments and the practice comment, development only):
// the JSON exactly as core writes it, so a time stays an RFC 3339 string.

// What the AI took the comment for ("" before it was read, or never asked).
export type CommentKind = "question" | "order" | "complaint" | "thanks" | "spam" | "unsure" | "";

// new: ansa is still on it. waiting: the AI's own texts wait for a person's
// Send or Discard ("Ask me first"). skipped: ansa left it (skipReason says why).
export type CommentStatus = "new" | "answered" | "waiting" | "skipped" | "failed";

// Why ansa left a comment ("" unless status is "skipped").
export type CommentSkipReason =
  | ""
  | "thanks"
  | "spam"
  | "own_comment"
  | "reply_in_thread"
  | "comments_off"
  | "package"
  | "limit"
  | "too_old"
  | "not_allowed";

// Where one of ansa's texts stands: waiting = for a person's Send.
export type CommentReplyStatus = "sent" | "failed" | "unclear" | "waiting";

// ansa's short public answer under the comment.
export type CommentPublicReply = { text: string; status: CommentReplyStatus };

// ansa's one private Messenger message to the commenter. conversationId: the
// Messenger conversation it opened ("" while there is none yet).
export type CommentPrivateMessage = { text: string; status: CommentReplyStatus; conversationId: string };

export type PageComment = {
  id: string;
  receivedAt: string;
  commenterName: string;
  // The first 200 characters of the post it is under ("" when unknown).
  postText: string;
  // "" when unreadable (a photo, a sticker): readable says which.
  text: string;
  readable: boolean;
  kind: CommentKind;
  status: CommentStatus;
  skipReason: CommentSkipReason;
  publicReply: CommentPublicReply | null;
  privateMessage: CommentPrivateMessage | null;
  // The request it was passed on as (0 = none).
  requestNumber: number;
};

// One page of the Comments list (50 a page), and whether ansa answers comments now.
export type CommentsPage = { comments: PageComment[]; total: number; page: number; pageSize: number; commentsOn: boolean };

// A waiting reply's Send or Discard: "changed" = it was no longer waiting.
export type CommentOutcome = "sent" | "discarded" | "changed";

// Settings → Connections: whether ansa answers comments, whether this person
// may change it (owners), and each Facebook Page of the company (allowed: it
// granted both comment permissions, or is a development stand-in).
export type CommentsSettings = { on: boolean; canChange: boolean; pages: { name: string; allowed: boolean }[] };

// The practice comment (development, owners): one of the stand-in Page's posts (its first 300 characters).
export type PracticePost = { id: string; text: string };

// A practice comment saved (its id, to follow it), or core's refusal in its words.
export type PracticeCommentSent = { ok: true; commentId: string } | { ok: false; error: string };

// A practice comment as the list shows it, and whether ansa is still on it.
export type PracticeCommentRead = PageComment & { next: "answering" | "done" };
