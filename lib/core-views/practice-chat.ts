import "server-only";
import { callCore } from "@/lib/core-api";

// The practice chat (step 58, development only): an owner writes as a
// made-up customer on WhatsApp, Telegram or Messenger through the company's
// stand-in accounts (core/internal/practicechat), and reads the chat as that
// customer sees it. ansa answers as it answers any customer. An owner may
// also send an email as one, to the company's forwarding address: it
// becomes a request as a forwarded email does.

export type PracticeChannel = "whatsapp" | "telegram" | "messenger";
// email: the practice email works here (real email is off).
export type PracticeChat = { available: boolean; isOwner: boolean; standIns: Record<PracticeChannel, boolean>; email: boolean };
export type PracticeLine = { fromCustomer: boolean; text: string; at: string };
export type PracticeSent = { ok: true; conversationId: string } | { ok: false; error: string };
// verified: as Resend reports DKIM or DMARC passed for the sender.
export type PracticeEmail = { name: string; address: string; subject: string; text: string; verified: boolean };
// to: the forwarding address the email went to. fields: a problem per field, in core's words.
export type PracticeEmailSent = { ok: true; to: string } | { ok: false; error: string; fields: Record<string, string> };

const NO_STAND_INS: Record<PracticeChannel, boolean> = { whatsapp: false, telegram: false, messenger: false };

// Whether this person may use it here (an owner, development), which
// channels have a stand-in account, and whether the practice email works.
export async function getPracticeChatFromCore(): Promise<PracticeChat> {
  const answer = await callCore<PracticeChat>("GET", "/api/v1/practice/chat");
  if (!answer.ok) {
    return { available: false, isOwner: false, standIns: NO_STAND_INS, email: false };
  }
  return { ...answer.data, standIns: { ...NO_STAND_INS, ...answer.data.standIns }, email: answer.data.email === true };
}

// Sends the made-up customer's email to the company's forwarding address:
// the address it went to.
export async function sendPracticeEmailThroughCore(email: PracticeEmail): Promise<PracticeEmailSent> {
  const answer = await callCore<{ to: string }>("POST", "/api/v1/practice/email", email);
  if (!answer.ok) {
    return { ok: false, error: answer.message, fields: answer.fields };
  }
  return { ok: true, to: answer.data.to };
}

// Saves the made-up customer's message, or (asBusiness) the business's own
// answer to them from its app: the conversation it is in.
export async function sendPracticeMessageThroughCore(channel: PracticeChannel, name: string, text: string, asBusiness: boolean): Promise<PracticeSent> {
  const answer = await callCore<{ conversationId: string }>("POST", "/api/v1/practice/chat", { channel, name, text, asBusiness });
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
