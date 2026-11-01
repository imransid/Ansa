import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { sendTelegramMessage } from "@/adapters/telegram";
import { readRawBodyWithLimit } from "@/lib/read-raw-body";
import { getClientIpFromHeaders } from "@/lib/request-ip";
import type { SocialFetch } from "@/lib/social-types";
import { currentTelegramMode, type TelegramBot, type TelegramMode } from "@/lib/telegram-mode";
import { telegramUpdateSchema } from "@/lib/validation/telegram";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";
import { runAssistantReply, type AssistantRunOptions } from "./assistant-reply";
import { handleTelegramUpdate, type NotifyOwner } from "./telegram-updates";
import type { RunAfterResponse } from "./vapi-webhook";

// LOGGING RULE for this file: never the body, a message, a name, an id or
// the bot's token. Fixed strings and class names only.

// Telegram's updates are small: one message of at most 4,096 characters
// with its details.
const MAX_BODY_BYTES = 256 * 1024;

// The header Telegram sends setWebhook's secret_token back in.
const SECRET_HEADER = "x-telegram-bot-api-secret-token";

// Only the checks pass these: Telegram's mode (with a made-up bot), a fake
// fetch, and the assistant's fakes (false: it doesn't answer, for the
// checks of step 48 that look at Telegram alone).
export type TelegramWebhookOptions = { mode?: TelegramMode; fetchFn?: SocialFetch; assistant?: AssistantRunOptions | false };

// Handles one webhook from Telegram (step 48). Never throws.
export async function handleTelegramWebhook(request: Request, runAfterResponse: RunAfterResponse, options: TelegramWebhookOptions = {}): Promise<Response> {
  try {
    return await processTelegramWebhook(request, runAfterResponse, options);
  } catch (error) {
    console.error(`Telegram webhook failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
    return emptyResponse(500);
  }
}

// Checks, reads and handles one update, in the order of the numbered steps;
// may throw (handleTelegramWebhook catches: a 500 makes Telegram send it again).
async function processTelegramWebhook(request: Request, runAfterResponse: RunAfterResponse, options: TelegramWebhookOptions): Promise<Response> {
  // 1. Raw bytes only, nothing parsed yet. 2. Prove they came from Telegram:
  // without ansa's bot (no secret) every request is refused.
  const rawBody = await readRawBodyWithLimit(request, MAX_BODY_BYTES);
  if (rawBody === "too-large") {
    console.warn("Telegram webhook rejected: body too large");
    return emptyResponse(413);
  }
  const mode = options.mode ?? currentTelegramMode();
  if (mode.kind !== "real" || !isTelegramsSecret(request.headers.get(SECRET_HEADER), mode.bot.webhookSecret)) {
    console.warn("Telegram webhook rejected: wrong secret");
    return emptyResponse(401);
  }
  if (await isOverRateLimit("telegram-webhook", getClientIpFromHeaders(request.headers), RATE_LIMITS.telegramWebhookPerIp)) {
    console.warn("Telegram webhook rejected: rate limited");
    return emptyResponse(429);
  }

  // 3. Only now parse. An update ansa can't read is answered 200 all the
  // same: Telegram sends a refused update again and again, holding back the
  // bot's later ones.
  const update = telegramUpdateSchema.safeParse(parseJsonOrNull(rawBody));
  if (!update.success) {
    console.warn("Telegram webhook ignored: not an update ansa reads");
    return emptyResponse(200);
  }
  // 4. Saved before the answer; the bot's notes to an owner go after it.
  const notify = notifyAfterResponse(mode.bot, options.fetchFn ?? fetch, runAfterResponse);
  // 5. The assistant answers a customer's message after Telegram has its 200.
  const assistant = options.assistant;
  await handleTelegramUpdate(update.data, notify, (turn) => {
    if (assistant !== false) {
      runAfterResponse(async () => {
        await runAssistantReply(turn, assistant);
      });
    }
  });
  return emptyResponse(200);
}

// Compares the header with the secret in constant time (their hashes, so
// the lengths match too).
export function isTelegramsSecret(header: string | null, secret: string): boolean {
  if (!header) {
    return false;
  }
  const given = createHash("sha256").update(header, "utf8").digest();
  const expected = createHash("sha256").update(secret, "utf8").digest();
  return timingSafeEqual(given, expected);
}

// Sends the bot's note to an owner after Telegram has its answer. A note
// that doesn't arrive is only logged (by its outcome).
function notifyAfterResponse(bot: TelegramBot, fetchFn: SocialFetch, runAfterResponse: RunAfterResponse): NotifyOwner {
  return (chatId, text) => {
    runAfterResponse(async () => {
      const result = await sendTelegramMessage({ token: bot.token, fetchFn }, { chatId, text, businessConnectionId: null });
      if (result.status !== "sent") {
        console.warn(`Telegram note to an owner not sent: ${result.error}`);
      }
    });
  };
}

// The body as JSON, or null when it isn't JSON (never the parse error: it can quote the body).
function parseJsonOrNull(rawBody: Buffer): unknown {
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    return null;
  }
}

// An answer with only a status: Telegram reads nothing else.
function emptyResponse(status: number): Response {
  return new Response(null, { status });
}
