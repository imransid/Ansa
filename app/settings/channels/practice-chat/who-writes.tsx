"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PracticeChannel } from "@/lib/core-views/practice-chat";
import { CHAT_CHANNELS } from "./chat-window";

type WhoWritesProps = {
  standIns: Record<PracticeChannel, boolean>;
  channel: PracticeChannel;
  writesEmail: boolean;
  name: string;
  // personal: one person's account, written to by people, not customers.
  personal: boolean;
  onPickChat: (channel: PracticeChannel) => void;
  onPickEmail: () => void;
  onNameChange: (name: string) => void;
};

// Above the practice chat: which app they write on (or an email), and
// their name (each name is one customer, with their own conversation).
export function WhoWrites(props: WhoWritesProps) {
  const { standIns, channel, writesEmail, name, personal, onPickChat, onPickEmail, onNameChange } = props;
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
              variant={!writesEmail && each.id === channel ? "default" : "outline"}
              aria-pressed={!writesEmail && each.id === channel}
              disabled={!standIns[each.id]}
              onClick={() => onPickChat(each.id)}
            >
              {each.label}
            </Button>
          ))}
          <Button type="button" size="sm" variant={writesEmail ? "default" : "outline"} aria-pressed={writesEmail} onClick={onPickEmail}>
            Email
          </Button>
        </div>
      </fieldset>
      {CHAT_CHANNELS.some((each) => !standIns[each.id]) && (
        <p className="text-sm text-muted-foreground">
          A greyed-out app needs a stand-in account first: connect one on{" "}
          <Link href="/settings/channels" className="text-link hover:underline">
            Connections
          </Link>
          .
        </p>
      )}
      {!writesEmail && (
        <div className="grid gap-1.5 sm:max-w-xs">
          <Label htmlFor="customer-name">{personal ? "Their name" : "Customer's name"}</Label>
          <Input id="customer-name" value={name} maxLength={100} onChange={(event) => onNameChange(event.target.value)} />
        </div>
      )}
    </div>
  );
}
