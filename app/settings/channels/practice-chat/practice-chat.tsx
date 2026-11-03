"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { findPracticeChatAction, readPracticeChatAction, sendPracticeMessageAction } from "@/app/actions/practice-chat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PracticeChannel, PracticeLine } from "@/lib/core-views/practice-chat";
import { CHAT_CHANNELS, ChatWindow } from "./chat-window";
import { MessageForm } from "./message-form";
import { PracticeEmail } from "./practice-email";

// How often the chat looks for ansa's answer, and for what ansa sends later
// (an order accepted on the Orders page, a teammate's reply).
const LOOK_EVERY_MS = 2000;

// When the server can't be reached (a dropped connection on a very busy
// laptop): the message may have arrived anyway, and the chat shows it if so.
const COULD_NOT_REACH = "ansa couldn't be reached just now. If your message doesn't show in the chat, send it again.";

// The customer's side: which app they write on (or an email), their name
// (each name is one customer, with their own conversation), and the chat
// itself. personal: one person's account, written to by people, not customers.
export function PracticeChat({ standIns, email, personal }: { standIns: Record<PracticeChannel, boolean>; email: boolean; personal: boolean }) {
  const [channel, setChannel] = useState<PracticeChannel>(CHAT_CHANNELS.find((each) => standIns[each.id])?.id ?? "whatsapp");
  // An email to your forwarding address instead of a chat.
  const [writesEmail, setWritesEmail] = useState(false);
  const [name, setName] = useState("Tanvir");
  const [text, setText] = useState("");
  // The business answers the customer from its own app instead.
  const [asBusiness, setAsBusiness] = useState(false);
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
      // null also when the server couldn't be reached: the next look finds it.
      const found = await findPracticeChatAction({ channel, name }).catch(() => null);
      if (!stopped && found) {
        setConversationId(found);
        const read = await readPracticeChatAction({ conversationId: found }).catch(() => null);
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
      // A look that failed (null) changes nothing: the next one tries again.
      const read = await readPracticeChatAction({ conversationId }).catch(() => null);
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
      const sent = await sendPracticeMessageAction({ channel, name, text: message, asBusiness }).catch(() => null);
      if (!sent) {
        // Said on the page, not an error screen: the typed message stays in the box.
        setError(COULD_NOT_REACH);
        await showChatIfThere();
        return;
      }
      if (!sent.ok) {
        setError(sent.error);
        return;
      }
      setError("");
      setText("");
      setConversationId(sent.conversationId);
      const read = await readPracticeChatAction({ conversationId: sent.conversationId }).catch(() => null);
      if (read) {
        setLines(read);
      }
    });
  }

  // After a send whose answer never came back: the message may have arrived
  // anyway, and then its chat shows (and keeps looking for ansa's answer).
  async function showChatIfThere() {
    const found = await findPracticeChatAction({ channel, name }).catch(() => null);
    if (found) {
      setConversationId(found);
    }
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
          <ChatWindow channel={channel} name={name} lines={lines} personal={personal} />
          <MessageForm
            businessApp={(CHAT_CHANNELS.find((each) => each.id === channel) ?? CHAT_CHANNELS[0]).businessApp}
            asBusiness={asBusiness}
            onAsBusinessChange={setAsBusiness}
            text={text}
            onTextChange={setText}
            error={error}
            isSending={isSending}
            canSend={standIns[channel] && name.trim() !== ""}
            onSubmit={send}
          />
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
