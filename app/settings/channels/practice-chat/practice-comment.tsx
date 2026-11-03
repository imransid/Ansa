"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { readPracticeCommentAction, sendPracticeCommentAction } from "@/app/actions/practice-chat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { PracticeCommentRead, PracticePost } from "@/lib/types/comments";
import { CommentThread, type ShownComment } from "./comment-thread";

// How long after one look at the comment the next starts, while ansa answers it.
const LOOK_EVERY_MS = 2000;

// The limits core checks for a practice comment.
const NAME_MAX_LENGTH = 100;
const TEXT_MAX_LENGTH = 2000;

// When the server can't be reached (a dropped connection on a very busy laptop).
const COULD_NOT_REACH = "ansa couldn't be reached just now. Try again in a moment.";

// How much of a post its menu option shows.
const POST_OPTION_LENGTH = 80;

// ansa may still change it: it is reading it, or its answer waits for a
// person's Send on the Comments page.
function stillChanging(read: PracticeCommentRead): boolean {
  return read.next === "answering" || read.status === "new" || read.status === "waiting";
}

// A post as its menu option names it: its first words.
function postOption(post: PracticePost): string {
  const text = post.text.trim() || "A post without text";
  return text.length > POST_OPTION_LENGTH ? `${text.slice(0, POST_OPTION_LENGTH)}...` : text;
}

type PracticeCommentProps = {
  posts: PracticePost[];
  // Opens the practice chat's Messenger chat of this name, where ansa's private message is.
  onOpenMessengerChat: (commenter: string) => void;
};

// A business's practice comment (development, owners): someone comments
// under one of the stand-in Facebook Page's posts, and the post shows with
// the comment under it and, as it comes, what ansa does: its answer under
// the comment, a private message in Messenger, a request for you, or
// nothing (praise, spam).
export function PracticeComment({ posts, onOpenMessengerChat }: PracticeCommentProps) {
  const [postId, setPostId] = useState(posts[0]?.id ?? "");
  const [name, setName] = useState("Farhana");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [shown, setShown] = useState<ShownComment | null>(null);
  const [commentId, setCommentId] = useState<string | null>(null);
  const [read, setRead] = useState<PracticeCommentRead | null>(null);
  const [isSending, startSending] = useTransition();
  // Server actions run one at a time: no look starts while a comment is being sent.
  const sending = useRef(false);

  // The next look starts only once the one before ended, and none after
  // ansa is done with the comment.
  useEffect(() => {
    if (!commentId) {
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = async () => {
      // A look that failed (null) changes nothing: the next one tries again.
      const next = sending.current ? null : await readPracticeCommentAction({ commentId }).catch(() => null);
      if (!stopped && next) {
        setRead(next);
      }
      if (!stopped && (next === null || stillChanging(next))) {
        timer = setTimeout(look, LOOK_EVERY_MS);
      }
    };
    timer = setTimeout(look, LOOK_EVERY_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [commentId]);

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const commenter = name.trim();
    const comment = text.trim();
    const post = posts.find((each) => each.id === postId);
    if (!post || !commenter || !comment || isSending) {
      return;
    }
    sending.current = true;
    startSending(async () => {
      try {
        const sent = await sendPracticeCommentAction({ postId, name: commenter, text: comment }).catch(() => null);
        if (!sent) {
          // Said on the page, not an error screen: the typed comment stays in the box.
          setError(COULD_NOT_REACH);
          return;
        }
        if (!sent.ok) {
          setError(sent.error);
          return;
        }
        setError("");
        setText("");
        setShown({ postText: post.text, name: commenter, text: comment });
        setRead(null);
        setCommentId(sent.commentId);
      } finally {
        sending.current = false;
      }
    });
  }

  return (
    <div className="grid gap-4">
      <form onSubmit={send} className="grid gap-4 rounded-2xl border bg-card p-5">
        <p className="text-sm text-muted-foreground">
          Comment as someone under one of your stand-in Facebook Page&apos;s posts. ansa answers a question under the comment, sends a
          price or an order question to them privately in Messenger, passes a complaint to you, and leaves praise and spam alone.
        </p>
        <div className="grid gap-1.5">
          <Label htmlFor="comment-post">The post</Label>
          <NativeSelect id="comment-post" value={postId} onChange={(event) => setPostId(event.target.value)}>
            {posts.map((post) => (
              <option key={post.id} value={post.id}>
                {postOption(post)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5 sm:max-w-xs">
          <Label htmlFor="commenter-name">Their name</Label>
          <Input id="commenter-name" value={name} maxLength={NAME_MAX_LENGTH} autoComplete="off" onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="comment-text">Comment</Label>
          <div className="flex gap-2">
            <Input
              id="comment-text"
              value={text}
              maxLength={TEXT_MAX_LENGTH}
              autoComplete="off"
              placeholder="Do you deliver to Gulshan?"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "comment-text-error" : undefined}
              onChange={(event) => setText(event.target.value)}
            />
            <Button type="submit" disabled={isSending || !name.trim() || !postId}>
              {isSending ? "Sending..." : "Comment"}
            </Button>
          </div>
          {error && (
            <p id="comment-text-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </form>
      {shown && (
        <>
          <CommentThread shown={shown} read={read} onOpenMessengerChat={onOpenMessengerChat} />
          <p className="text-sm">
            Your side:{" "}
            <a href="/inbox/comments" target="_blank" rel="noreferrer" className="text-link hover:underline">
              the comments in your Inbox
            </a>{" "}
            (opens in a new tab).
          </p>
        </>
      )}
    </div>
  );
}
