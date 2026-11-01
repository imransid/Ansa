import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { AssistantTurn } from "@/db/assistant-runs";
import { insertCustomerChatMessage } from "@/db/conversation-writes";
import {
  claimTelegramLinkCode,
  deletePendingConnection,
  findClaimedLinkCode,
  findPendingConnection,
  findTelegramConnectionForMessages,
  linkTelegramAccount,
  savePendingConnection,
  updateLinkedTelegramAccount,
  type ClaimedLinkCode,
  type LinkOutcome,
  type TelegramAccountFacts,
} from "@/db/telegram-links";
import { deleteTelegramMessages, insertBusinessAccountMessage } from "@/db/telegram-messages";
import { telegramContact } from "@/lib/conversation-contacts";
import { encryptText } from "@/lib/encryption";
import { conversationMessageContext } from "@/lib/encryption-contexts";
import { toPlainSingleLine } from "@/lib/plain-text";
import { BOT_NOTES, describeTelegramMessage, readStartCode, telegramDisplayName } from "@/lib/telegram";
import type { TelegramBusinessConnection, TelegramDeletedMessages, TelegramMessage, TelegramUpdate } from "@/lib/validation/telegram";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// What ansa does with one update from Telegram (step 48), after the
// webhook checked its secret and read it (services/telegram-webhook.ts), or
// after pnpm telegram:poll fetched it with the bot's token (development):
// an owner's Start with a code, a restaurant's account connecting or
// changing, a customer's message, messages deleted in Telegram. The company
// comes from a code ansa made, or a connection a code tied to it; nothing
// Telegram sends names a company. LOGGING RULE: never a message, a name or
// an id; fixed lines only.

// How the bot answers its owner in its own chat: the webhook sends these
// after its answer, the poll script at once. Best effort.
export type NotifyOwner = (chatId: string, text: string) => void;

// What to do once a customer's message is saved: the assistant answers it
// (step 49; the webhook after its answer, the poll script at once).
export type AnswerCustomer = (turn: AssistantTurn) => void;

// Handles one update; anything ansa doesn't use is ignored.
export async function handleTelegramUpdate(update: TelegramUpdate, notify: NotifyOwner, answer: AnswerCustomer = () => undefined): Promise<void> {
  if (update.message) {
    await handleBotChatMessage(update.message, notify);
  } else if (update.business_connection) {
    await handleBusinessConnection(update.business_connection, notify);
  } else if (update.business_message) {
    await handleBusinessMessage(update.business_message, answer);
  } else if (update.deleted_business_messages) {
    await handleDeletedMessages(update.deleted_business_messages);
  }
}

// A message to the bot in its own chat: the owner's Start with the code
// from Settings → Connections, or anything else from anyone (told how to connect).
async function handleBotChatMessage(message: TelegramMessage, notify: NotifyOwner): Promise<void> {
  const from = message.from;
  if (message.chat.type !== "private" || !from || from.is_bot) {
    return;
  }
  if (await isOverRateLimit("telegram-bot-chat", from.id, RATE_LIMITS.telegramBotChatsPerUser)) {
    return;
  }
  const code = readStartCode(message.text);
  if (!code) {
    notify(message.chat.id, BOT_NOTES.needsLink);
    return;
  }
  const claimed = await claimTelegramLinkCode(hashTelegramLinkCode(code), from.id);
  if (!claimed) {
    notify(message.chat.id, BOT_NOTES.linkExpired);
    return;
  }
  // The bot may have been added before this Start: it waits as pending.
  const pending = await findPendingConnection(from.id);
  if (!pending) {
    notify(message.chat.id, BOT_NOTES.waitingForChatbot);
    return;
  }
  const outcome = await linkTelegramAccount(claimed, pending);
  notify(pending.accountChatId, noteFor(outcome));
}

// The restaurant's Telegram account added, changed or removed the bot.
async function handleBusinessConnection(connection: TelegramBusinessConnection, notify: NotifyOwner): Promise<void> {
  const facts = accountFacts(connection);
  const status = await updateLinkedTelegramAccount({ ...facts, isEnabled: connection.is_enabled });
  if (status !== null) {
    return;
  }
  if (!connection.is_enabled) {
    await deletePendingConnection(facts.externalId);
    return;
  }
  const claimed: ClaimedLinkCode | null = await findClaimedLinkCode(facts.accountTelegramId);
  if (!claimed) {
    // Added before the Start: kept for an hour, until a code names the company.
    await savePendingConnection(facts);
    notify(facts.accountChatId, BOT_NOTES.needsLink);
    return;
  }
  notify(facts.accountChatId, noteFor(await linkTelegramAccount(claimed, facts)));
}

// A message in one of the restaurant's Telegram chats: the customer's, or
// one the restaurant wrote in its own app. ansa's own replies come back too
// (sent by the bot) and are already saved.
async function handleBusinessMessage(message: TelegramMessage, answer: AnswerCustomer): Promise<void> {
  if (!message.businessConnectionId || message.chat.type !== "private" || message.sentByBot || !message.from) {
    return;
  }
  const connection = await findTelegramConnectionForMessages(message.businessConnectionId);
  if (!connection) {
    console.warn("Telegram message ignored: its account isn't connected to ansa");
    return;
  }
  const text = describeTelegramMessage(message);
  if (text === null) {
    return;
  }
  const messageId = randomUUID();
  const saved = {
    messageId,
    bodyEncrypted: encryptText(text, conversationMessageContext(connection.companyId, messageId)),
    channelMessageId: message.messageId,
  };
  const contact = telegramContact(message.chat);
  if (message.from.id === connection.accountTelegramId) {
    await insertBusinessAccountMessage(connection.companyId, contact, saved);
    return;
  }
  const turn = await insertCustomerChatMessage(connection.companyId, contact, saved);
  if (turn) {
    answer(turn);
  }
}

// Messages deleted in Telegram: ansa deletes its copies too.
async function handleDeletedMessages(deleted: TelegramDeletedMessages): Promise<void> {
  const connection = await findTelegramConnectionForMessages(deleted.business_connection_id);
  if (!connection) {
    return;
  }
  await deleteTelegramMessages(connection.companyId, deleted.chat.id, deleted.message_ids.map(String));
}

function accountFacts(connection: TelegramBusinessConnection): TelegramAccountFacts {
  const name = toPlainSingleLine(telegramDisplayName(connection.user) ?? "").slice(0, 200).trim();
  return {
    externalId: connection.id,
    accountTelegramId: connection.user.id,
    accountChatId: connection.user_chat_id,
    displayName: name || "Telegram account",
    canReply: connection.rights?.can_reply === true,
  };
}

function noteFor(outcome: LinkOutcome): string {
  switch (outcome) {
    case "connected":
      return BOT_NOTES.connected;
    case "cannot-reply":
      return BOT_NOTES.connectedCannotReply;
    case "elsewhere":
      return BOT_NOTES.alreadyConnectedElsewhere;
    case "company-has-another":
      return BOT_NOTES.companyHasAnother;
    default:
      return BOT_NOTES.linkExpired;
  }
}

// What a link code is stored as: its SHA-256 hash, as hex. WHY no secret
// key: the code is 256 random bits, so its hash can't be turned back into it.
export function hashTelegramLinkCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}
