import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { readRawBodyWithLimit } from "@/lib/read-raw-body";
import { getClientIpFromHeaders } from "@/lib/request-ip";
import { currentPlatformMode, type PlatformMode } from "@/lib/social-mode";
import type { SocialFetch } from "@/lib/social-types";
import { messengerWebhookSchema } from "@/lib/validation/messenger";
import { runAssistantReply, type AssistantRunOptions } from "./assistant-reply";
import { fillMessengerName, handleMessengerEvent } from "./messenger-updates";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";
import type { RunAfterResponse } from "./vapi-webhook";

// Meta's Messenger webhook (step 53). LOGGING RULE for this file: never
// the body, a message, a name, an id or a token. Fixed strings and class
// names only.

// Meta batches events; a batch of text messages stays far below this.
const MAX_BODY_BYTES = 512 * 1024;
const SIGNATURE_HEADER = "x-hub-signature-256";

// Only the checks pass these: Facebook's mode (a made-up app), a fake
// fetch, and the assistant's fakes (false: it doesn't answer).
export type MessengerWebhookOptions = { mode?: PlatformMode; fetchFn?: SocialFetch; assistant?: AssistantRunOptions | false };

// Meta's one-time check when the webhook is set up: its challenge back,
// only for ansa's verify token (compared in constant time).
export function answerMessengerVerification(url: URL, verifyToken: string | undefined = env.MESSENGER_VERIFY_TOKEN): Response {
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  const token = url.searchParams.get("hub.verify_token");
  if (!verifyToken || url.searchParams.get("hub.mode") !== "subscribe" || !sameSecret(token, verifyToken) || !/^[A-Za-z0-9_-]{1,200}$/.test(challenge)) {
    console.warn("Messenger webhook verification refused");
    return new Response(null, { status: 403 });
  }
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

// Handles one webhook from Meta. Never throws.
export async function handleMessengerWebhook(request: Request, runAfterResponse: RunAfterResponse, options: MessengerWebhookOptions = {}): Promise<Response> {
  try {
    return await processMessengerWebhook(request, runAfterResponse, options);
  } catch (error) {
    console.error(`Messenger webhook failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
    return new Response(null, { status: 500 });
  }
}

async function processMessengerWebhook(request: Request, runAfterResponse: RunAfterResponse, options: MessengerWebhookOptions): Promise<Response> {
  // 1. Raw bytes only. 2. Meta's signature over exactly those bytes, with
  // ansa's app secret: without ansa's Meta app every request is refused.
  const rawBody = await readRawBodyWithLimit(request, MAX_BODY_BYTES);
  if (rawBody === "too-large") {
    console.warn("Messenger webhook rejected: body too large");
    return new Response(null, { status: 413 });
  }
  const mode = options.mode ?? currentPlatformMode("facebook");
  if (mode.kind !== "real" || !isMetasSignature(request.headers.get(SIGNATURE_HEADER), rawBody, mode.credentials.clientSecret)) {
    console.warn("Messenger webhook rejected: bad signature");
    return new Response(null, { status: 401 });
  }
  if (await isOverRateLimit("messenger-webhook", getClientIpFromHeaders(request.headers), RATE_LIMITS.messengerWebhookPerIp)) {
    console.warn("Messenger webhook rejected: rate limited");
    return new Response(null, { status: 429 });
  }
  // 3. Only now parse. One ansa can't read is answered 200 all the same:
  // Meta sends a refused one again and again.
  const parsed = messengerWebhookSchema.safeParse(parseJsonOrNull(rawBody));
  if (!parsed.success) {
    console.warn("Messenger webhook ignored: not a Page event ansa reads");
    return new Response(null, { status: 200 });
  }
  // 4. Saved before the answer; the name and the assistant's reply after it.
  for (const entry of parsed.data.entry) {
    for (const event of entry.messaging ?? []) {
      await handleMessengerEvent(entry.id, event, mode.credentials.clientId, (turn, page) => {
        runAfterResponse(async () => {
          await fillMessengerName(turn, page, { mode, fetchFn: options.fetchFn });
          if (options.assistant !== false) {
            await runAssistantReply(turn, options.assistant);
          }
        });
      });
    }
  }
  return new Response(null, { status: 200 });
}

// "sha256=" + the HMAC-SHA256 of the raw body with the app secret, compared
// in constant time.
export function isMetasSignature(header: string | null, rawBody: Buffer, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) {
    return false;
  }
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  return sameSecret(header.toLowerCase(), expected);
}

// Two strings compared in constant time (their hashes, so lengths match too).
function sameSecret(given: string | null, expected: string): boolean {
  if (given === null) {
    return false;
  }
  return timingSafeEqual(createHash("sha256").update(given, "utf8").digest(), createHash("sha256").update(expected, "utf8").digest());
}

// The body as JSON, or null (never the parse error: it can quote the body).
function parseJsonOrNull(rawBody: Buffer): unknown {
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    return null;
  }
}
