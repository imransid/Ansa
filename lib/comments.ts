import type { CommentKind, CommentReplyStatus, CommentSkipReason } from "@/lib/types/comments";

// The words the Comments page and the practice comment use for what ansa did
// with a comment on the business's Facebook posts: one place, so both say
// the same, in a restaurant owner's words (never core's codes).

// What the AI took the comment for.
export const COMMENT_KIND_LABELS: Record<Exclude<CommentKind, "">, string> = {
  question: "Question",
  order: "Price or order",
  complaint: "Complaint",
  thanks: "Praise",
  spam: "Spam",
  unsure: "Not sure",
};

// Why ansa left a comment, after "ansa left it: ".
export const COMMENT_SKIP_TEXT: Record<CommentSkipReason, string> = {
  "": "it needed no answer.",
  thanks: "it's praise or thanks, with nothing to answer.",
  spam: "it looks like spam. Hide or delete it on Facebook if you like: ansa never does.",
  own_comment: "it's your Page's own comment.",
  reply_in_thread: "it's a reply inside a thread: ansa answers comments on the post itself.",
  comments_off: "answering comments was switched off (Settings → Connections).",
  package: "your package has no AI replies left this month, or doesn't include comments (Billing).",
  limit: "too many comments came in at once: ansa answers only so many an hour.",
  too_old: "it's more than 7 days old: ansa answers only newer comments.",
  not_allowed: "Facebook hasn't allowed ansa to answer comments on this Page yet: connect the Page again and allow comments.",
  discarded: "someone on your team discarded ansa's reply, so nothing was sent.",
};

// Where one of ansa's texts stands, after the text itself. where: where it
// went (under the comment, or Messenger), so "check" names the right place.
export function commentReplyStatusText(status: CommentReplyStatus, where: "post" | "messenger"): string {
  const place = where === "post" ? "the post on Facebook" : "Messenger";
  switch (status) {
    case "sent":
      return "Sent.";
    case "waiting":
      return "Waits for you: Send or Discard it.";
    case "failed":
      return "Not sent: Facebook refused it.";
    case "unclear":
      return `Facebook didn't confirm it: check ${place}.`;
  }
}

// Who wrote the comment, when Facebook gave no name.
export function commenterLabel(name: string): string {
  return name.trim() || "Someone";
}
