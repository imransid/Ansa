"use client";

import { useEffect, useRef } from "react";
import type { PracticeChannel, PracticeLine } from "@/lib/core-views/practice-chat";
import { cn } from "@/lib/utils";

// Each app's look, enough to tell them apart in a demo. Fixed light colours
// in dark mode too, as the apps' own chats keep (white text on each header
// stays above 4.5:1). businessApp: where the business answers itself.
export const CHAT_CHANNELS: { id: PracticeChannel; label: string; header: string; own: string; businessApp: string }[] = [
  { id: "whatsapp", label: "WhatsApp", header: "bg-[#075e54]", own: "bg-[#d9fdd3]", businessApp: "the WhatsApp Business app" },
  { id: "telegram", label: "Telegram", header: "bg-[#1b5f8c]", own: "bg-[#dff1fd]", businessApp: "its Telegram app" },
  { id: "messenger", label: "Messenger", header: "bg-[#0a4fbf]", own: "bg-[#e3edff]", businessApp: "its Facebook Page's inbox" },
];

// How long after the customer's last message "ansa is writing..." shows: an
// answer usually comes within seconds; none after this means ansa is
// waiting (Ask me first, a teammate took over, or it chose not to answer).
const TYPING_SHOWN_MS = 90_000;

// Who writes to whom, above the chat.
function chatTitle(name: string, personal: boolean): string {
  if (personal) {
    return `${name.trim() || "Someone"} writing to you`;
  }
  return `${name.trim() || "Customer"} writing to your business`;
}

// The chat as the customer sees it on their phone: their own messages on the
// right, the business's (ansa's, or its own from its app) on the left.
// personal: they write to one person, not to a business.
export function ChatWindow({ channel, name, lines, personal }: { channel: PracticeChannel; name: string; lines: PracticeLine[]; personal: boolean }) {
  const look = CHAT_CHANNELS.find((each) => each.id === channel) ?? CHAT_CHANNELS[0];
  const bottom = useRef<HTMLDivElement>(null);
  const last = lines.at(-1);
  // Date.now() is read when the chat re-renders, which it does every time
  // the page looks for new messages.
  // eslint-disable-next-line react-hooks/purity
  const typing = last?.fromCustomer === true && Date.now() - Date.parse(last.at) < TYPING_SHOWN_MS;

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [lines.length, typing]);

  return (
    <section aria-label={`${look.label} chat of ${name || "the customer"}`} className="overflow-hidden rounded-3xl border bg-[#f4f1ec] text-[#11211a]">
      <div className={cn("flex items-center justify-between px-4 py-3 text-sm text-white", look.header)}>
        <span className="font-semibold">{look.label}</span>
        <span>{chatTitle(name, personal)}</span>
      </div>
      <div aria-live="polite" className="grid max-h-[28rem] min-h-64 content-start gap-2 overflow-y-auto p-4">
        {lines.length === 0 && <p className="text-sm text-[#4a5a52]">Write a message below, as {name.trim() || "the customer"} would.</p>}
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
        <div ref={bottom} />
      </div>
    </section>
  );
}
