"use client";

import { useEffect } from "react";
import { findPracticeChatAction, readPracticeChatAction } from "@/app/actions/practice-chat";
import type { PracticeChannel, PracticeChatRead } from "@/lib/core-views/practice-chat";

type FindChatOptions = {
  channel: PracticeChannel;
  name: string;
  // The channel has a stand-in account: without one there is no chat to find.
  available: boolean;
  // Grows to look up the same customer again (the Messenger chat a practice
  // comment's private message opened, maybe since the last lookup).
  lookups: number;
  setConversationId: (conversationId: string) => void;
  setChat: (chat: PracticeChatRead) => void;
};

// The customer's chat so far, if they wrote before (a reload, back from the
// Orders page, or after a practice comment): looked up once the name stops
// changing, then shown.
export function useFindChat({ channel, name, available, lookups, setConversationId, setChat }: FindChatOptions) {
  useEffect(() => {
    if (!name.trim() || !available) {
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
  }, [channel, name, available, lookups, setConversationId, setChat]);
}
