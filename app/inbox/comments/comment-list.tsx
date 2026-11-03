import { LocalDateTime } from "@/components/local-date-time";
import { COMMENT_KIND_LABELS, commenterLabel } from "@/lib/comments";
import type { PageComment } from "@/lib/types/comments";
import { CommentOutcome } from "./comment-outcome";

// The Comments page's rows: who commented, when, under which post, what
// they wrote, and below it what ansa did.
export function CommentList({ comments }: { comments: PageComment[] }) {
  return (
    <ul className="divide-y border-y">
      {comments.map((comment) => (
        <li key={comment.id} className="grid gap-2 py-4 sm:px-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold">{commenterLabel(comment.commenterName)}</span>
              {comment.kind !== "" && <span className="text-xs text-muted-foreground">{COMMENT_KIND_LABELS[comment.kind]}</span>}
            </span>
            <span className="text-xs text-subtle-foreground">
              <LocalDateTime iso={comment.receivedAt} />
            </span>
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {comment.postText ? <>On your post &ldquo;{comment.postText}&rdquo;</> : "On one of your posts"}
          </p>
          <CommentText comment={comment} />
          <CommentOutcome comment={comment} />
        </li>
      ))}
    </ul>
  );
}

// The comment as written, or why there is nothing to show.
function CommentText({ comment }: { comment: PageComment }) {
  if (!comment.readable) {
    return <p className="text-sm text-muted-foreground italic">No words ansa can read (a photo, a sticker or a GIF): open it on Facebook.</p>;
  }
  return <p className="whitespace-pre-wrap wrap-anywhere">{comment.text}</p>;
}
