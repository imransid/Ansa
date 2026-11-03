"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { findPracticeChatAction, readPracticeChatAction, sendPracticeMessageAction } from "@/app/actions/practice-chat";
import type { PracticeChannel, PracticeLine, PracticeNext } from "@/lib/core-views/practice-chat";
import type { PracticePost } from "@/lib/types/comments";
import { CHAT_CHANNELS, ChatWindow } from "./chat-window";
import { MessageForm } from "./message-form";
import { PracticeComment } from "./practice-comment";
import { PracticeEmail } from "./practice-email";
import { useFindChat } from "./use-find-chat";
import { WhoWrites, type PracticeWrites } from "./who-writes";

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

// The customer's side: which app they write on (or an email, or a comment on
// the Facebook Page's posts), their name (each name is one customer, with
// their own conversation), and the chat itself. personal: one person's
// account, written to by people, not customers. commentPosts: a business's
// stand-in Page's posts for a practice comment ([] = none can be written).
export function PracticeChat(props: { standIns: Record<PracticeChannel, boolean>; email: boolean; personal: boolean; commentPosts: PracticePost[] }) {
  const { standIns, email, personal, commentPosts } = props;
  const [channel, setChannel] = useState<PracticeChannel>(CHAT_CHANNELS.find((each) => standIns[each.id])?.id ?? "whatsapp");
  // A chat, or instead an email to your forwarding address or a comment under a post.
  const [writes, setWrites] = useState<PracticeWrites>("chat");
  const [name, setName] = useState("Tanvir");
  const [text, setText] = useState("");
  // The business (or the person) answers from its own app instead.
  const [asBusiness, setAsBusiness] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [chat, setChat] = useState<ShownChat>(NO_CHAT);
  const [error, setError] = useState("");
  const [isSending, startSending] = useTransition();
  // Asks the lookup of the customer's chat to run again.
  const [lookups, setLookups] = useState(0);
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

  // Back from an email or a comment, the same app keeps its chat.
  function pickChat(nextChannel: PracticeChannel) {
    setWrites("chat");
    if (nextChannel !== channel) {
      changeCustomer(nextChannel, name);
    }
  }

  // "Open their Messenger chat" under a practice comment: ansa's private
  // message to the commenter is there, and the conversation goes on in it.
  // Their chat is looked up again (lookups), also when they are the customer already shown.
  function openMessengerChat(commenter: string) {
    setWrites("chat");
    changeCustomer("messenger", commenter);
    setLookups((count) => count + 1);
  }

  // The customer's chat so far, if they wrote before.
  useFindChat({ channel, name, available: standIns[channel], lookups, setConversationId, setChat });

  // The next look starts only once the one before ended: on a busy laptop a
  // slow answer never piles reads up in front of a send.
  useEffect(() => {
    if (!conversationId || writes !== "chat") {
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
  }, [conversationId, writes]);

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
        writes={writes}
        name={name}
        personal={personal}
        canComment={commentPosts.length > 0 && standIns.messenger}
        onPickChat={pickChat}
        onPick={setWrites}
        onNameChange={(nextName) => changeCustomer(channel, nextName)}
      />
      {/* Kept while hidden: back from a chat, the comment still shows what ansa did. */}
      {commentPosts.length > 0 && (
        <div hidden={writes !== "comment"}>
          <PracticeComment posts={commentPosts} onOpenMessengerChat={openMessengerChat} />
        </div>
      )}
      {writes === "email" && <PracticeEmail available={email} personal={personal} />}
      {writes === "chat" && (
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
