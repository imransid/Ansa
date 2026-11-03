import type { ReactNode } from "react";
import Link from "next/link";
import { discardCommentReplyAction, sendCommentReplyAction } from "@/app/actions/comments";
import { ActionButton } from "@/components/action-button";
import { ConfirmButton } from "@/components/confirm-button";
import { StatusDot } from "@/components/status-dot";
import { COMMENT_SKIP_TEXT, commenterLabel, commentReplyStatusText } from "@/lib/comments";
import type { CommentReplyStatus, PageComment } from "@/lib/types/comments";
import { cn } from "@/lib/utils";

// What ansa did with one comment: where it stands, its public answer under
// the comment, its private message in Messenger (with the conversation it
// opened), the request it passed to you, and, while ansa's own texts wait
// for a person ("Ask me first"), Send and Discard.
export function CommentOutcome({ comment }: { comment: PageComment }) {
  const { publicReply, privateMessage, requestNumber } = comment;
  return (
    <div className="grid gap-3 border-l-2 pl-3">
      <CommentStatusLine comment={comment} />
      {publicReply && <AnsaText title="ansa's answer under the comment" text={publicReply.text} status={publicReply.status} where="post" />}
      {privateMessage && (
        <AnsaText title="ansa's private message in Messenger" text={privateMessage.text} status={privateMessage.status} where="messenger">
          {privateMessage.conversationId !== "" && (
            <Link href={`/inbox/${privateMessage.conversationId}`} className="text-link hover:underline">
              Open the Messenger conversation
            </Link>
          )}
        </AnsaText>
      )}
      {requestNumber > 0 && (
        <p className="text-sm">
          Passed to you:{" "}
          <Link href={`/tickets/${requestNumber}`} className="text-link hover:underline">
            request #{requestNumber}
          </Link>
        </p>
      )}
      {comment.status === "waiting" && <WaitingReplyButtons commentId={comment.id} who={commenterLabel(comment.commenterName)} />}
    </div>
  );
}

// Where the comment stands, in a word or a sentence.
function CommentStatusLine({ comment }: { comment: PageComment }) {
  switch (comment.status) {
    case "new":
      return <StatusDot tone="info">ansa is reading it...</StatusDot>;
    case "answered":
      return <StatusDot tone="success">ansa answered it</StatusDot>;
    case "waiting":
      return <StatusDot tone="attention">ansa&apos;s answer waits for you: Send or Discard it.</StatusDot>;
    case "skipped":
      return <StatusDot tone="quiet">ansa left it: {COMMENT_SKIP_TEXT[comment.skipReason]}</StatusDot>;
    case "failed":
      return <StatusDot tone="problem">ansa couldn&apos;t answer it. Answer it on Facebook yourself.</StatusDot>;
  }
}

type AnsaTextProps = {
  title: string;
  text: string;
  status: CommentReplyStatus;
  where: "post" | "messenger";
  children?: ReactNode;
};

// One text ansa wrote for the comment, and whether it went out.
function AnsaText({ title, text, status, where, children }: AnsaTextProps) {
  return (
    <div className="grid gap-1 text-sm">
      <span className="font-medium">{title}</span>
      <p className="rounded-xl bg-muted/60 px-3 py-2 whitespace-pre-wrap wrap-anywhere">{text}</p>
      <span className="flex flex-wrap gap-x-3 gap-y-1">
        <span className={cn(status === "failed" ? "text-destructive" : "text-muted-foreground")}>{commentReplyStatusText(status, where)}</span>
        {children}
      </span>
    </div>
  );
}

// "Ask me first": ansa's own texts for this comment go out as written, or
// never (anyone in the company, as with a chat's waiting reply).
function WaitingReplyButtons({ commentId, who }: { commentId: string; who: string }) {
  const fields = { commentId };
  return (
    <div className="flex flex-wrap items-start gap-2">
      <ActionButton action={sendCommentReplyAction} fields={fields} label="Send" accessibleLabel={`Send ansa's answer to ${who}'s comment as written`} />
      <ConfirmButton
        action={discardCommentReplyAction}
        fields={fields}
        label="Discard"
        accessibleLabel={`Discard ansa's answer to ${who}'s comment`}
        question="Discard ansa's answer? Nothing goes out under the comment or in Messenger."
        confirmLabel="Discard"
        pendingLabel="Discarding..."
      />
    </div>
  );
}
