"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { findPracticeChatAction, readPracticeChatAction, sendPracticeMessageAction } from "@/app/actions/practice-chat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PracticeChannel, PracticeLine } from "@/lib/core-views/practice-chat";
import { CHAT_CHANNELS, ChatWindow } from "./chat-window";
import { PracticeEmail } from "./practice-email";

// How often the chat looks for ansa's answer, and for what ansa sends later
// (an order accepted on the Orders page, a teammate's reply).
const LOOK_EVERY_MS = 2000;

// The customer's side: which app they write on (or an email), their name
// (each name is one customer, with their own conversation), and the chat itself.
export function PracticeChat({ standIns, email }: { standIns: Record<PracticeChannel, boolean>; email: boolean }) {
  const [channel, setChannel] = useState<PracticeChannel>(CHAT_CHANNELS.find((each) => standIns[each.id])?.id ?? "whatsapp");
  // An email to your forwarding address instead of a chat.
  const [writesEmail, setWritesEmail] = useState(false);
  const [name, setName] = useState("Tanvir");
  const [text, setText] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [lines, setLines] = useState<PracticeLine[]>([]);
  const [error, setError] = useState("");
  const [isSending, startSending] = useTransition();

  // Another app or another name is another customer: their chat starts here.
  function changeCustomer(nextChannel: PracticeChannel, nextName: string) {
    setChannel(nextChannel);
    setName(nextName);
    setConversationId(null);
    setLines([]);
    setError("");
  }

  // Back from an email, the same app keeps its chat.
  function pickChat(nextChannel: PracticeChannel) {
    setWritesEmail(false);
    if (nextChannel !== channel) {
      changeCustomer(nextChannel, name);
    }
  }

  // The customer's chat so far, if they wrote before (a reload, or back from
  // the Orders page): looked up once the name stops changing.
  useEffect(() => {
    if (!name.trim() || !standIns[channel]) {
      return;
    }
    let stopped = false;
    const timer = setTimeout(async () => {
      const found = await findPracticeChatAction({ channel, name });
      if (!stopped && found) {
        setConversationId(found);
        const read = await readPracticeChatAction({ conversationId: found });
        if (!stopped && read) {
          setLines(read);
        }
      }
    }, 400);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [channel, name, standIns]);

  useEffect(() => {
    if (!conversationId || writesEmail) {
      return;
    }
    let stopped = false;
    const look = async () => {
      const read = await readPracticeChatAction({ conversationId });
      if (!stopped && read) {
        setLines(read);
      }
    };
    const timer = setInterval(look, LOOK_EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [conversationId, writesEmail]);

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = text.trim();
    if (!message || isSending) {
      return;
    }
    startSending(async () => {
      const sent = await sendPracticeMessageAction({ channel, name, text: message });
      if (!sent.ok) {
        setError(sent.error);
        return;
      }
      setError("");
      setText("");
      setConversationId(sent.conversationId);
      const read = await readPracticeChatAction({ conversationId: sent.conversationId });
      if (read) {
        setLines(read);
      }
    });
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-2xl border bg-card p-5">
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">The customer writes on</legend>
          <div className="flex flex-wrap gap-2">
            {CHAT_CHANNELS.map((each) => (
              <Button
                key={each.id}
                type="button"
                size="sm"
                variant={!writesEmail && each.id === channel ? "default" : "outline"}
                aria-pressed={!writesEmail && each.id === channel}
                disabled={!standIns[each.id]}
                onClick={() => pickChat(each.id)}
              >
                {each.label}
              </Button>
            ))}
            <Button type="button" size="sm" variant={writesEmail ? "default" : "outline"} aria-pressed={writesEmail} onClick={() => setWritesEmail(true)}>
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
            <Label htmlFor="customer-name">Customer&apos;s name</Label>
            <Input id="customer-name" value={name} maxLength={100} onChange={(event) => changeCustomer(channel, event.target.value)} />
          </div>
        )}
      </div>
      {writesEmail ? (
        <PracticeEmail available={email} />
      ) : (
        <>
          <ChatWindow channel={channel} name={name} lines={lines} />
          <form onSubmit={send} className="grid gap-2">
            <Label htmlFor="customer-message">Message</Label>
            <div className="flex gap-2">
              <Input
                id="customer-message"
                value={text}
                maxLength={4000}
                autoComplete="off"
                placeholder="Are you open tonight?"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "customer-message-error" : undefined}
                onChange={(event) => setText(event.target.value)}
              />
              <Button type="submit" disabled={isSending || !standIns[channel] || !name.trim()}>
                {isSending ? "Sending..." : "Send"}
              </Button>
            </div>
            {error && (
              <p id="customer-message-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </form>
          {conversationId && (
            <p className="text-sm">
              Your side:{" "}
              <a href={`/inbox/${conversationId}`} target="_blank" rel="noreferrer" className="text-link hover:underline">
                this conversation in your Inbox
              </a>{" "}
              (opens in a new tab).
            </p>
          )}
        </>
      )}
    </div>
  );
}
