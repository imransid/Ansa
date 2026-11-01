// Shared by the Telegram checks (step 48): a made-up bot, a fake Telegram
// that records what ansa asked it, and updates sent through the webhook as
// Telegram sends them. Nothing here reaches Telegram.

import assert from "node:assert/strict";
import type { TelegramMode } from "@/lib/telegram-mode";
import type { AssistantRunOptions } from "@/services/assistant-reply";
import { startTelegramConnectForSession } from "@/services/telegram-connect";
import { handleTelegramWebhook } from "@/services/telegram-webhook";
import { runId, sessionFor, type TestUser } from "./helpers";

export const FAKE_BOT = {
  token: "123456789:CHECKfakeTokenThatIsNeverRealAAAAAAAAAA",
  username: "ansa_check_bot",
  webhookSecret: "check-secret-0123456789abcdef0123456789abcdef",
};
export const REAL_MODE: TelegramMode = { kind: "real", bot: FAKE_BOT };

// One request ansa made to the fake Telegram: the API method and its JSON body.
export type TelegramRequest = { method: string; body: Record<string, unknown> };

// A fake Telegram: answers every request with `answer` (by default a sent
// message, its id counting up as Telegram's do in a chat) and records it.
// `answer` may throw, as fetch does with no answer.
let nextSentId = 1;
export function fakeTelegram(answer: () => Response = () => sentAnswer(nextSentId++)) {
  const requests: TelegramRequest[] = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    assert.ok(url.startsWith(`https://api.telegram.org/bot${FAKE_BOT.token}/`), "a request went somewhere other than Telegram's API");
    requests.push({ method: url.split("/").at(-1) ?? "", body: JSON.parse(String(init.body)) });
    return answer();
  };
  return { fetchFn, requests };
}

export function sentAnswer(messageId: number): Response {
  return Response.json({ ok: true, result: { message_id: messageId } });
}

// Telegram ids for this run, unlikely to meet another run's.
let nextId = Number.parseInt(runId.slice(0, 6), 16) * 1000;
export function telegramId(): number {
  nextId += 1;
  return nextId;
}

// The address every check webhook comes from (the per-IP limit counts it).
const CHECK_IP = "198.51.100.48";

// Posts one update to the webhook as Telegram would (with the secret,
// unless given another), runs what it leaves for after the answer, and
// returns the answer's status.
export async function postUpdate(
  update: Record<string, unknown>,
  options: { secret?: string | null; fetchFn?: ReturnType<typeof fakeTelegram>["fetchFn"]; assistant?: AssistantRunOptions | false } = {},
) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": CHECK_IP };
  const secret = options.secret === undefined ? FAKE_BOT.webhookSecret : options.secret;
  if (secret !== null) {
    headers["x-telegram-bot-api-secret-token"] = secret;
  }
  const request = new Request("http://localhost/api/webhooks/telegram", { method: "POST", headers, body: JSON.stringify({ update_id: telegramId(), ...update }) });
  const afterTasks: (() => Promise<void>)[] = [];
  // The assistant (step 49) doesn't answer unless a check gives it a fake model.
  const assistant = options.assistant ?? false;
  const response = await handleTelegramWebhook(request, (task) => afterTasks.push(task), { mode: REAL_MODE, fetchFn: options.fetchFn ?? fakeTelegram().fetchFn, assistant });
  for (const task of afterTasks) {
    await task();
  }
  return response.status;
}

// An owner's one-time link, and the code in it.
export async function connectCodeFor(owner: TestUser): Promise<string> {
  const result = await startTelegramConnectForSession(sessionFor(owner), REAL_MODE);
  assert.ok(result.ok, JSON.stringify(result));
  const code = new URL(result.link).searchParams.get("start");
  assert.ok(result.link.startsWith(`https://t.me/${FAKE_BOT.username}?start=`) && code);
  return code;
}

// The updates Telegram sends, as ansa reads them.
export function startMessage(telegramUserId: number, text: string) {
  return { message: { message_id: telegramId(), chat: { id: telegramUserId, type: "private" }, from: { id: telegramUserId, is_bot: false, first_name: "Owner" }, text } };
}

export function businessConnection(externalId: string, telegramUserId: number, options: { enabled?: boolean; canReply?: boolean } = {}) {
  return {
    business_connection: {
      id: externalId,
      user: { id: telegramUserId, is_bot: false, first_name: "Luigi's", last_name: "Trattoria" },
      user_chat_id: telegramUserId,
      date: 1_700_000_000,
      rights: { can_reply: options.canReply ?? true },
      is_enabled: options.enabled ?? true,
    },
  };
}

export function businessMessage(externalId: string, chatId: number, fromId: number, extra: Record<string, unknown> = {}, messageId = telegramId()) {
  return {
    business_message: {
      message_id: messageId,
      business_connection_id: externalId,
      chat: { id: chatId, type: "private", first_name: "Lena", last_name: "Moretti" },
      from: { id: fromId, is_bot: false, first_name: "Lena" },
      ...extra,
    },
  };
}

// A business connection id for this run (the cleanup finds waiting ones by it).
export function connectionId(label: string): string {
  return `check-${runId}-${label}`;
}
