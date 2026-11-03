"use client";

import type { ReactNode } from "react";
import { COMMENT_SKIP_TEXT } from "@/lib/comments";
import type { PracticeCommentRead } from "@/lib/types/comments";
import { cn } from "@/lib/utils";

// The practice comment as it was sent: the post's text, who, and what they wrote.
export type ShownComment = { postText: string; name: string; text: string };

// A link inside the thread: a fixed colour, as the thread keeps Facebook's
// light look in dark mode too.
const THREAD_LINK = "text-[#1c4f9c] underline underline-offset-2 hover:no-underline";

type CommentThreadProps = {
  shown: ShownComment;
  // What ansa did with it so far (null: not read yet).
  read: PracticeCommentRead | null;
  onOpenMessengerChat: (commenter: string) => void;
};

// The post as people see it on Facebook, the comment under it and ansa's
// answer under that; below them, for the presenter, a line on what else
// ansa did (a private message, a request, or nothing).
export function CommentThread({ shown, read, onOpenMessengerChat }: CommentThreadProps) {
  const reply = read?.publicReply;
  return (
    <section aria-label={`Facebook post with ${shown.name}'s comment`} className="overflow-hidden rounded-3xl border bg-white text-[#11211a]">
      <div className="flex items-center justify-between bg-[#1c4f9c] px-4 py-3 text-sm text-white">
        <span className="font-semibold">Facebook</span>
        <span>Your Page&apos;s post</span>
      </div>
      <div className="grid gap-3 p-4">
        <p className="text-sm whitespace-pre-wrap wrap-anywhere">{shown.postText || "A post without text"}</p>
        <div aria-live="polite" className="grid gap-2 border-t pt-3">
          <Bubble author={shown.name} text={shown.text} />
          {reply && reply.status !== "failed" && (
            <div className="ml-8 grid gap-1">
              <Bubble author="Your Page (ansa)" text={reply.text} notPosted={reply.status === "waiting"} />
              {reply.status === "waiting" && <Note>Not posted yet: it waits for you to send it.</Note>}
            </div>
          )}
          {reply && reply.status === "failed" && <Note>Facebook refused ansa&apos;s answer under the comment.</Note>}
          <WhatElse read={read} commenter={shown.name} onOpenMessengerChat={onOpenMessengerChat} />
        </div>
      </div>
    </section>
  );
}

// One comment or reply, as Facebook shows it: the name, then the words. A
// reply not posted yet (it waits for a person) has a dashed outline instead.
function Bubble({ author, text, notPosted = false }: { author: string; text: string; notPosted?: boolean }) {
  return (
    <p
      className={cn(
        "justify-self-start rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap wrap-anywhere",
        notPosted ? "border border-dashed border-[#7a8a82] bg-white" : "bg-[#f0f2f5]",
      )}
    >
      <span className="block font-semibold">{author}</span>
      {text}
    </p>
  );
}

// A small line for the presenter, not part of Facebook's page.
function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs text-[#4a5a52]">{children}</p>;
}

// What ansa did besides its public answer, or that it is still on it.
function WhatElse({ read, commenter, onOpenMessengerChat }: { read: PracticeCommentRead | null; commenter: string; onOpenMessengerChat: (name: string) => void }) {
  if (!read || read.next === "answering" || read.status === "new") {
    return <p className="text-sm text-[#4a5a52] italic">ansa is reading the comment...</p>;
  }
  const message = read.privateMessage;
  return (
    <div className="grid gap-1.5">
      {message && message.status === "waiting" && <Note>ansa wrote them a private message in Messenger: it waits for you to send it.</Note>}
      {message && (message.status === "sent" || message.status === "unclear") && (
        <Note>
          ansa sent them a private message in Messenger.{" "}
          <button type="button" className={THREAD_LINK} onClick={() => onOpenMessengerChat(commenter)}>
            Open {commenter}&apos;s Messenger chat
          </button>{" "}
          to see it and answer as them.
        </Note>
      )}
      {read.requestNumber > 0 && (
        <Note>
          ansa passed it to you:{" "}
          <a href={`/tickets/${read.requestNumber}`} target="_blank" rel="noreferrer" className={THREAD_LINK}>
            request #{read.requestNumber}
          </a>{" "}
          (opens in a new tab).
        </Note>
      )}
      <StatusNote read={read} />
    </div>
  );
}

// Where ansa stands with it: left (and why), waiting for you, or failed.
function StatusNote({ read }: { read: PracticeCommentRead }) {
  switch (read.status) {
    case "skipped":
      return read.skipReason === "thanks" || read.skipReason === "spam" ? (
        <Note>ansa leaves this one: praise and spam need no answer.</Note>
      ) : (
        <Note>ansa leaves this one: {COMMENT_SKIP_TEXT[read.skipReason]}</Note>
      );
    case "waiting":
      return (
        <Note>
          With Ask me first, ansa&apos;s answer waits for you:{" "}
          <a href="/inbox/comments" target="_blank" rel="noreferrer" className={THREAD_LINK}>
            Inbox → Comments
          </a>{" "}
          (opens in a new tab), Send or Discard.
        </Note>
      );
    case "failed":
      return <Note>ansa couldn&apos;t answer it. Inbox → Comments says what happened.</Note>;
    default:
      return null;
  }
}
