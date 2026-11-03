"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PracticeChannel } from "@/lib/core-views/practice-chat";
import { CHAT_CHANNELS } from "./chat-window";

// What the practice chat's customer writes: a chat message, an email to the
// forwarding address, or (a business) a comment under its Facebook Page's posts.
export type PracticeWrites = "chat" | "email" | "comment";

type WhoWritesProps = {
  standIns: Record<PracticeChannel, boolean>;
  channel: PracticeChannel;
  writes: PracticeWrites;
  name: string;
  // personal: one person's account, written to by people, not customers.
  personal: boolean;
  // A practice comment can be written: the stand-in Facebook Page has posts.
  canComment: boolean;
  onPickChat: (channel: PracticeChannel) => void;
  onPick: (writes: Exclude<PracticeWrites, "chat">) => void;
  onNameChange: (name: string) => void;
};

// Above the practice chat: which app they write on (or an email, or a
// comment on Facebook), and their name (each name is one customer, with
// their own conversation).
export function WhoWrites(props: WhoWritesProps) {
  const { standIns, channel, writes, name, personal, canComment, onPickChat, onPick, onNameChange } = props;
  const writesChat = writes === "chat";
  return (
    <div className="grid gap-3 rounded-2xl border bg-card p-5">
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">{personal ? "Who writes, and on which app" : "The customer writes on"}</legend>
        <div className="flex flex-wrap gap-2">
          {CHAT_CHANNELS.map((each) => (
            <Button
              key={each.id}
              type="button"
              size="sm"
              variant={writesChat && each.id === channel ? "default" : "outline"}
              aria-pressed={writesChat && each.id === channel}
              disabled={!standIns[each.id]}
              onClick={() => onPickChat(each.id)}
            >
              {each.label}
            </Button>
          ))}
          <Button type="button" size="sm" variant={writes === "email" ? "default" : "outline"} aria-pressed={writes === "email"} onClick={() => onPick("email")}>
            Email
          </Button>
          {/* Comments on a Page's posts are a business's. */}
          {!personal && (
            <Button
              type="button"
              size="sm"
              variant={writes === "comment" ? "default" : "outline"}
              aria-pressed={writes === "comment"}
              disabled={!canComment}
              onClick={() => onPick("comment")}
            >
              Facebook comment
            </Button>
          )}
        </div>
      </fieldset>
      {(CHAT_CHANNELS.some((each) => !standIns[each.id]) || (!personal && !canComment)) && (
        <p className="text-sm text-muted-foreground">
          {personal
            ? "A greyed-out app needs a stand-in account first: connect one on "
            : "A greyed-out choice needs a stand-in account first (a Facebook comment, the stand-in Facebook Page): connect one on "}
          <Link href="/settings/channels" className="text-link hover:underline">
            Connections
          </Link>
          .
        </p>
      )}
      {writesChat && (
        <div className="grid gap-1.5 sm:max-w-xs">
          <Label htmlFor="customer-name">{personal ? "Their name" : "Customer's name"}</Label>
          <Input id="customer-name" value={name} maxLength={100} onChange={(event) => onNameChange(event.target.value)} />
        </div>
      )}
    </div>
  );
}
