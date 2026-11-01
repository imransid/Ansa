import "server-only";
import type { SendError } from "@/lib/conversations";
import { API_TIMEOUT_MS, discardAnswer, readJsonAnswer, sendToPlatform } from "@/lib/social-http";
import type { SocialFetch } from "@/lib/social-types";
import { TELEGRAM_UPDATE_TYPES } from "@/lib/telegram";
import { telegramOkAnswerSchema, telegramSendAnswerSchema, telegramUpdatesAnswerSchema } from "@/lib/validation/telegram";

// The ONLY file that talks to Telegram's Bot API (step 48). The bot's token
// is part of every address (api.telegram.org/bot<token>/...), so no address,
// error or answer is ever logged or kept; requests go through
// lib/social-http.ts (a time limit each, no redirect, answers read capped
// through Zod). Telegram's own words (an answer's "description") are never
// read: only ok, the message id and the error's number.

export type TelegramContext = { token: string; fetchFn: SocialFetch };

export type TelegramSendResult =
  | { status: "sent"; channelMessageId: string }
  | { status: "failed"; error: SendError }
  | { status: "unclear"; error: "no_answer" };

const API_HOST = "https://api.telegram.org";

// A long poll waits this long for updates, and its request a little longer.
const POLL_WAIT_SECONDS = 25;

function methodUrl(context: TelegramContext, method: string): string {
  return `${API_HOST}/bot${context.token}/${method}`;
}

function jsonRequest(body: Record<string, unknown>): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// Sends one text message: to a customer on behalf of a restaurant's
// Telegram account (businessConnectionId), or to the owner in the bot's own
// chat (none). "unclear": Telegram didn't answer, or failed on its side, so
// the message may have arrived: never sent again by itself.
export async function sendTelegramMessage(
  context: TelegramContext,
  message: { chatId: string; text: string; businessConnectionId: string | null },
): Promise<TelegramSendResult> {
  const body: Record<string, unknown> = { chat_id: message.chatId, text: message.text };
  if (message.businessConnectionId) {
    body.business_connection_id = message.businessConnectionId;
  }
  const answer = await sendToPlatform(context.fetchFn, methodUrl(context, "sendMessage"), jsonRequest(body), API_TIMEOUT_MS);
  if (answer.kind === "no_answer" || answer.response.status >= 500) {
    if (answer.kind === "answered") {
      await discardAnswer(answer.response);
    }
    return { status: "unclear", error: "no_answer" };
  }
  const read = await readJsonAnswer(answer.response, telegramSendAnswerSchema);
  if (answer.response.ok && read?.ok && read.result) {
    return { status: "sent", channelMessageId: String(read.result.message_id) };
  }
  return { status: "failed", error: sendErrorFor(answer.response.status) };
}

// What a refusal means, by its HTTP status only.
function sendErrorFor(status: number): SendError {
  if (status === 429) {
    return "rate_limited";
  }
  // A wrong or revoked token: Telegram answers 401, or 404 for a token it
  // doesn't know at all.
  if (status === 401 || status === 404) {
    return "bot_rejected";
  }
  return "refused";
}

export type TelegramPollResult = { kind: "updates"; updates: unknown[] } | { kind: "webhook_set" } | { kind: "failed"; status: number | null };

// Reads the bot's waiting updates from `offset` on, waiting up to 25
// seconds for one (development only: pnpm telegram:poll). Telegram refuses
// it (409) while a webhook is set.
export async function getTelegramUpdates(context: TelegramContext, offset: number): Promise<TelegramPollResult> {
  const body = { offset, timeout: POLL_WAIT_SECONDS, allowed_updates: TELEGRAM_UPDATE_TYPES };
  const answer = await sendToPlatform(context.fetchFn, methodUrl(context, "getUpdates"), jsonRequest(body), (POLL_WAIT_SECONDS + 10) * 1000);
  if (answer.kind === "no_answer") {
    return { kind: "failed", status: null };
  }
  if (answer.response.status === 409) {
    await discardAnswer(answer.response);
    return { kind: "webhook_set" };
  }
  const read = await readJsonAnswer(answer.response, telegramUpdatesAnswerSchema);
  if (answer.response.ok && read?.ok && read.result) {
    return { kind: "updates", updates: read.result };
  }
  return { kind: "failed", status: answer.response.status };
}

// Tells Telegram where to send the bot's updates, with the secret it sends
// back in a header (ansa's operator: pnpm telegram:webhook set). Returns
// the HTTP status of a refusal, or null when it worked.
export async function setTelegramWebhook(context: TelegramContext, url: string, secretToken: string): Promise<number | null> {
  const body = { url, secret_token: secretToken, allowed_updates: TELEGRAM_UPDATE_TYPES, max_connections: 40 };
  return okOrStatus(await sendToPlatform(context.fetchFn, methodUrl(context, "setWebhook"), jsonRequest(body), API_TIMEOUT_MS));
}

// Removes the webhook, so the bot's updates wait for getUpdates (pnpm
// telegram:webhook remove, for a development bot).
export async function deleteTelegramWebhook(context: TelegramContext): Promise<number | null> {
  return okOrStatus(await sendToPlatform(context.fetchFn, methodUrl(context, "deleteWebhook"), jsonRequest({}), API_TIMEOUT_MS));
}

async function okOrStatus(answer: Awaited<ReturnType<typeof sendToPlatform>>): Promise<number | null> {
  if (answer.kind === "no_answer") {
    return 0;
  }
  const read = await readJsonAnswer(answer.response, telegramOkAnswerSchema);
  return answer.response.ok && read?.ok ? null : answer.response.status;
}
