"use client";

import { useEffect, useRef } from "react";
import { LocalDateTime } from "@/components/local-date-time";
import type { PracticeChannel, PracticeLine, PracticeNext } from "@/lib/core-views/practice-chat";
import { cn } from "@/lib/utils";

// Each app's look, enough to tell them apart in a demo. Fixed light colours
// in dark mode too, as the apps' own chats keep (white text on each header
// stays above 4.5:1). businessApp / personApp: where a business, or one
// person, answers themselves.
export const CHAT_CHANNELS: { id: PracticeChannel; label: string; header: string; own: string; businessApp: string; personApp: string }[] = [
  { id: "whatsapp", label: "WhatsApp", header: "bg-[#075e54]", own: "bg-[#d9fdd3]", businessApp: "the WhatsApp Business app", personApp: "the WhatsApp Business app" },
  { id: "telegram", label: "Telegram", header: "bg-[#1b5f8c]", own: "bg-[#dff1fd]", businessApp: "its Telegram app", personApp: "your Telegram app" },
  { id: "messenger", label: "Messenger", header: "bg-[#0a4fbf]", own: "bg-[#e3edff]", businessApp: "its Facebook Page's inbox", personApp: "your Facebook Page's inbox" },
];

// "ansa is writing..." shows while core says ansa answers the newest
// message, at most this long after it: a run that never ends (a failure
// core keeps retrying) doesn't keep it up for ever.
const TYPING_SHOWN_MS = 180_000;

// Who writes to whom, above the chat.
function chatTitle(name: string, personal: boolean): string {
  if (personal) {
    return `${name.trim() || "Someone"} writing to you`;
  }
  return `${name.trim() || "Customer"} writing to your business`;
}

type ChatWindowProps = {
  channel: PracticeChannel;
  name: string;
  lines: PracticeLine[];
  // What ansa does next with the newest message (null: not known yet).
  next: PracticeNext | null;
  // personal: they write to one person, not to a business.
  personal: boolean;
};

// The chat as the customer sees it on their phone: their own messages on the
// right, the business's (ansa's, or its own from its app) on the left. Below
// the customer's newest message, "ansa is writing..." only while ansa will
// answer it, else a line for the presenter saying why it doesn't.
export function ChatWindow({ channel, name, lines, next, personal }: ChatWindowProps) {
  const look = CHAT_CHANNELS.find((each) => each.id === channel) ?? CHAT_CHANNELS[0];
  const bottom = useRef<HTMLDivElement>(null);
  const last = lines.at(-1);
  const waitsForAnsa = last?.fromCustomer === true && next !== null;
  // Date.now() is read when the chat re-renders, which it does every time
  // the page looks for new messages.
  // eslint-disable-next-line react-hooks/purity
  const typing = waitsForAnsa && next.what === "answers" && Date.now() - Date.parse(last.at) < TYPING_SHOWN_MS;
  const quiet = waitsForAnsa && next.what !== "answers";

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [lines.length, typing, quiet]);

  return (
    <section
      aria-label={`${look.label} chat of ${name || (personal ? "the sender" : "the customer")}`}
      className="overflow-hidden rounded-3xl border bg-[#f4f1ec] text-[#11211a]"
    >
      <div className={cn("flex items-center justify-between px-4 py-3 text-sm text-white", look.header)}>
        <span className="font-semibold">{look.label}</span>
        <span>{chatTitle(name, personal)}</span>
      </div>
      <div aria-live="polite" className="grid max-h-[28rem] min-h-64 content-start gap-2 overflow-y-auto p-4">
        {lines.length === 0 && (
          <p className="text-sm text-[#4a5a52]">Write a message below, as {name.trim() || (personal ? "they" : "the customer")} would.</p>
        )}
        {lines.map((line, index) => (
          <p
            key={`${line.at}-${index}`}
            className={cn(
              "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap shadow-sm wrap-anywhere",
              line.fromCustomer ? cn("justify-self-end rounded-br-md", look.own) : "justify-self-start rounded-bl-md bg-white",
            )}
          >
            {line.text}
          </p>
        ))}
        {typing && <p className="justify-self-start rounded-2xl bg-white/70 px-3.5 py-2 text-sm text-[#4a5a52] italic">ansa is writing...</p>}
        {quiet && (
          <p className="justify-self-center px-3 text-center text-xs text-[#4a5a52]">
            <QuietNote next={next} personal={personal} />
          </p>
        )}
        <div ref={bottom} />
      </div>
    </section>
  );
}

// For the presenter, not the customer: why ansa doesn't answer the newest
// message (now), in the words of the account it answers for.
function QuietNote({ next, personal }: { next: PracticeNext; personal: boolean }) {
  const you = personal ? "you" : "a person";
  switch (next.what) {
    case "answers_at":
      return next.at ? (
        <>
          ansa answers at <LocalDateTime iso={next.at} timeOnly /> unless you reply first.
        </>
      ) : null;
    case "draft":
      return <>ansa wrote a reply that waits for you to send it (Ask me first): see this conversation in your Inbox.</>;
    case "paused":
      return <>ansa leaves this one to {you}: it is paused.</>;
    case "taken_over":
      return <>ansa leaves this one to {you}: this conversation was taken over (Hand back in your Inbox gives it back).</>;
    case "request_open":
      return personal ? (
        <>ansa leaves this one to you: it already passed this conversation on to you, so you answer next.</>
      ) : (
        <>ansa leaves this one to a person: a request is open, so a person answers next.</>
      );
    case "told_you":
      return <>ansa told you at once: they&apos;re one of your important people, and you answer next.</>;
    case "you_answer":
      return <>ansa leaves this one to you: you&apos;re available (Only when I&apos;m away).</>;
    case "nothing":
      return <>ansa didn&apos;t answer this one: it needed no answer.</>;
  }
  return null;
}
