import "server-only";
import { callCore } from "@/lib/core-api";

// The practice chat (step 58, development only): an owner writes as a
// made-up customer on WhatsApp, Telegram or Messenger through the company's
// stand-in accounts (core/internal/practicechat), and reads the chat as that
// customer sees it. ansa answers as it answers any customer.

export type PracticeChannel = "whatsapp" | "telegram" | "messenger";
export type PracticeChat = { available: boolean; isOwner: boolean; standIns: Record<PracticeChannel, boolean> };
export type PracticeLine = { fromCustomer: boolean; text: string; at: string };
export type PracticeSent = { ok: true; conversationId: string } | { ok: false; error: string };

const NO_STAND_INS: Record<PracticeChannel, boolean> = { whatsapp: false, telegram: false, messenger: false };

// Whether this person may use it here (an owner, development), and which
// channels have a stand-in account.
export async function getPracticeChatFromCore(): Promise<PracticeChat> {
  const answer = await callCore<PracticeChat>("GET", "/api/v1/practice/chat");
  if (!answer.ok) {
    return { available: false, isOwner: false, standIns: NO_STAND_INS };
  }
  return { ...answer.data, standIns: { ...NO_STAND_INS, ...answer.data.standIns } };
}

// Saves the made-up customer's message: the conversation it joined.
export async function sendPracticeMessageThroughCore(channel: PracticeChannel, name: string, text: string): Promise<PracticeSent> {
  const answer = await callCore<{ conversationId: string }>("POST", "/api/v1/practice/chat", { channel, name, text });
  if (!answer.ok) {
    return { ok: false, error: answer.fields.text ?? answer.fields.name ?? answer.fields.channel ?? answer.message };
  }
  return { ok: true, conversationId: answer.data.conversationId };
}

// The chat as the customer sees it (null: it couldn't be read).
export async function readPracticeChatFromCore(conversationId: string): Promise<PracticeLine[] | null> {
  const answer = await callCore<{ lines: PracticeLine[] }>("GET", `/api/v1/practice/chat/${conversationId}`);
  return answer.ok ? answer.data.lines : null;
}

// The made-up customer's conversation on the channel, so the page shows it
// again after a reload ("" before their first message).
export async function findPracticeChatFromCore(channel: PracticeChannel, name: string): Promise<string> {
  const query = new URLSearchParams({ channel, name });
  const answer = await callCore<{ conversationId: string }>("GET", `/api/v1/practice/chat/find?${query.toString()}`);
  return answer.ok ? answer.data.conversationId : "";
}
