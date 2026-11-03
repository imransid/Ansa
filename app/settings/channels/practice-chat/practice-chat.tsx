"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { findPracticeChatAction, readPracticeChatAction, sendPracticeMessageAction } from "@/app/actions/practice-chat";
import type { PracticeChannel, PracticeLine, PracticeNext } from "@/lib/core-views/practice-chat";
import { CHAT_CHANNELS, ChatWindow } from "./chat-window";
import { MessageForm } from "./message-form";
import { PracticeEmail } from "./practice-email";
import { WhoWrites } from "./who-writes";

// How long after one look at the chat the next starts, for ansa's answer
// and for what ansa sends later (an order accepted on the Orders page, a
// teammate's reply).
const LOOK_EVERY_MS = 2000;

// When the server can't be reached (a dropped connection on a very busy
// laptop): the message may have arrived anyway, and the chat shows it if so.
const COULD_NOT_REACH = "ansa couldn't be reached just now. If your message doesn't show in the chat, send it again.";

// The chat as the page shows it: next is null while not known yet (a
// message just sent: the next look says what ansa does with it).
type ShownChat = { lines: PracticeLine[]; next: PracticeNext | null };
const NO_CHAT: ShownChat = { lines: [], next: null };

// The customer's side: which app they write on (or an email), their name
// (each name is one customer, with their own conversation), and the chat
// itself. personal: one person's account, written to by people, not customers.
export function PracticeChat({ standIns, email, personal }: { standIns: Record<PracticeChannel, boolean>; email: boolean; personal: boolean }) {
  const [channel, setChannel] = useState<PracticeChannel>(CHAT_CHANNELS.find((each) => standIns[each.id])?.id ?? "whatsapp");
  // An email to your forwarding address instead of a chat.
  const [writesEmail, setWritesEmail] = useState(false);
  const [name, setName] = useState("Tanvir");
  const [text, setText] = useState("");
  // The business (or the person) answers from its own app instead.
  const [asBusiness, setAsBusiness] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [chat, setChat] = useState<ShownChat>(NO_CHAT);
  const [error, setError] = useState("");
  const [isSending, startSending] = useTransition();
  // Server actions run one at a time: while a message is being sent the
  // chat isn't read, so the send never waits behind reads. sends counts
  // them, so a read that started before a send never shows an older chat.
  const sending = useRef(false);
  const sends = useRef(0);

  // Another app or another name is another customer: their chat starts here.
  function changeCustomer(nextChannel: PracticeChannel, nextName: string) {
    setChannel(nextChannel);
    setName(nextName);
    setConversationId(null);
    setChat(NO_CHAT);
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
          setChat(read);
        }
      }
    }, 400);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [channel, name, standIns]);

  // The next look starts only once the one before ended: on a busy laptop a
  // slow answer never piles reads up in front of a send.
  useEffect(() => {
    if (!conversationId || writesEmail) {
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = async () => {
      if (!sending.current) {
        const sendsBefore = sends.current;
        // A look that failed (null) changes nothing: the next one tries again.
        const read = await readPracticeChatAction({ conversationId }).catch(() => null);
        if (!stopped && read && sends.current === sendsBefore) {
          setChat(read);
        }
      }
      if (!stopped) {
        timer = setTimeout(look, LOOK_EVERY_MS);
      }
    };
    timer = setTimeout(look, LOOK_EVERY_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [conversationId, writesEmail]);

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = text.trim();
    if (!message || isSending) {
      return;
    }
    const fromCustomer = !asBusiness;
    sending.current = true;
    sends.current += 1;
    startSending(async () => {
      try {
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
        // Shown at once; the next look brings the chat as core has it, and
        // what ansa does with it.
        setChat((shown) => ({ lines: [...shown.lines, { fromCustomer, text: message, at: new Date().toISOString() }], next: null }));
      } finally {
        sending.current = false;
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

  const chatApp = CHAT_CHANNELS.find((each) => each.id === channel) ?? CHAT_CHANNELS[0];
  return (
    <div className="grid gap-4">
      <WhoWrites
        standIns={standIns}
        channel={channel}
        writesEmail={writesEmail}
        name={name}
        personal={personal}
        onPickChat={pickChat}
        onPickEmail={() => setWritesEmail(true)}
        onNameChange={(nextName) => changeCustomer(channel, nextName)}
      />
      {writesEmail ? (
        <PracticeEmail available={email} personal={personal} />
      ) : (
        <>
          <ChatWindow channel={channel} name={name} lines={chat.lines} next={chat.next} personal={personal} />
          <MessageForm
            ownApp={personal ? chatApp.personApp : chatApp.businessApp}
            personal={personal}
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
