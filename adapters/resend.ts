import "server-only";
import { Resend } from "resend";
import { toDeliveryErrorCode } from "@/lib/delivery-error-code";
import { env } from "@/lib/env";
import { retryWhileTemporary } from "@/lib/retry";
import type { EmailMessage, EmailSendResult } from "@/lib/send-email";

// Translates our calls into Resend's API: sending an email (lib/send-email.ts)
// and fetching a received one (lib/inbound-email.ts). Only used when
// SEND_REAL_EMAIL=true (lib/env.ts then requires the API key). The key is
// always handed to the SDK from lib/env.ts, never left for it to find.

// How long sending one email may take. Without a limit, an API that stops
// answering holds the request for Node's 5-minute default: "Mark as solved"
// would end on an error screen for a ticket that was solved, and the work
// after a webhook (assignment emails) would use up the run's 300 seconds.
export const SEND_TIMEOUT_MS = 20_000;

// What one send answers (the SDK's shape, narrowed to what we read).
type SendResponse = { data: { id: string } | null; error: { name?: unknown; message?: unknown } | null };

// Sends one email through Resend, giving up after SEND_TIMEOUT_MS.
export async function sendWithResend(message: EmailMessage): Promise<EmailSendResult> {
  if (!env.RESEND_API_KEY) {
    return { ok: false, error: "missing_api_key" };
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const payload = {
    from: message.from,
    to: message.to,
    replyTo: message.replyTo ?? undefined,
    subject: message.subject,
    html: message.html,
    text: message.text,
  };
  return requestSend((signal) => resend.emails.send(payload, { idempotencyKey: message.idempotencyKey, signal }));
}

// Runs `send` (one send through the SDK) with a time limit. Running out of
// time is a failed delivery, stored as "timeout": Resend may still have
// accepted it, but a Retry can't send it twice, because the email's id is
// Resend's idempotency key (services/customer-emails.ts). Exported for the
// checks, which pass a fake request and a short time.
export async function requestSend(send: (signal: AbortSignal) => Promise<SendResponse>, timeoutMs = SEND_TIMEOUT_MS): Promise<EmailSendResult> {
  const signal = AbortSignal.timeout(timeoutMs);
  const { data, error } = await send(signal);
  if (error || !data) {
    // A send cut off by the limit comes back from the SDK like a network failure.
    return { ok: false, error: signal.aborted ? "timeout" : describeResendError(error ?? {}) };
  }
  return { ok: true, providerMessageId: data.id };
}

// Only Resend's error code ("validation_error", "rate_limit_exceeded", ...),
// never its message: lib/delivery-error-code.ts says why. Exported for the checks.
export function describeResendError(error: { name?: unknown; message?: unknown }): string {
  return toDeliveryErrorCode(error.name);
}

// How long one try may take, and how long to wait before trying again when
// Resend's API has a temporary problem (1 second, then 4). Without a time
// limit, a request that never answers waits for Node's 5-minute default: the
// whole run's time (maxDuration), so everything after it would be cut off.
// Resend allows 10 requests a second for ALL our sending and fetching
// together, so a busy moment answers 429.
export type ReceivingTiming = { timeoutMs: number; retryDelaysMs: number[] };
export const RECEIVING_TIMING: ReceivingTiming = { timeoutMs: 20_000, retryDelaysMs: [1_000, 4_000] };

// The longest fetching one received email can take: every try runs out of
// time, with the waits between them (services/stuck-work.ts uses it).
export function longestReceivingFetchMs(timing: ReceivingTiming = RECEIVING_TIMING): number {
  return timing.timeoutMs * (timing.retryDelaysMs.length + 1) + timing.retryDelaysMs.reduce((sum, delay) => sum + delay, 0);
}

// What one Receiving API call answers (the SDK's shape, narrowed to what we read).
type ReceivingResponse = { data: unknown; error: { name?: unknown; statusCode?: number | null } | null };

// The content of one received email from Resend's Receiving API, as Resend
// sent it, or null when Resend can't give it (after up to 3 tries for
// temporary problems). lib/inbound-email.ts checks it with the same schema as
// the dev stand-in's. Inline images stay "cid:" references instead of
// base64 copies inside the HTML, which only the stripped text is made from.
export async function fetchReceivedEmailFromResend(resendEmailId: string): Promise<unknown> {
  if (!env.RESEND_API_KEY) {
    return null;
  }
  const resend = new Resend(env.RESEND_API_KEY);
  return requestReceivedEmail((signal) => resend.emails.receiving.get(resendEmailId, { html_format: "cid" }, { signal }));
}

// Runs `request` (one Receiving API call) with a time limit per try, tries
// again on temporary problems, and returns the content, or null after one
// fixed log line with Resend's error code and HTTP status (never its message:
// lib/delivery-error-code.ts says why). A try that runs out of time comes back
// from the SDK like a network failure (no status), so it is tried again.
// Exported for the checks, which pass a fake request and short times.
export async function requestReceivedEmail(
  request: (signal: AbortSignal) => Promise<ReceivingResponse>,
  timing: ReceivingTiming = RECEIVING_TIMING,
): Promise<unknown> {
  const response = await retryWhileTemporary(
    () => request(AbortSignal.timeout(timing.timeoutMs)),
    (result) => isTemporaryResendError(result.error),
    timing.retryDelaysMs,
  );
  if (response.error || !response.data) {
    console.error(`Resend receiving fetch failed: ${describeReceivingFailure(response.error)}`);
    return null;
  }
  return response.data;
}

// "restricted_api_key 401" (an API key with sending access only), or
// "application_error no-status" (no answer in time).
function describeReceivingFailure(error: ReceivingResponse["error"]): string {
  if (!error) {
    return "no_content";
  }
  return `${toDeliveryErrorCode(error.name)} ${error.statusCode ?? "no-status"}`;
}

// Too many requests (429), a server error (5xx), or no answer at all (the SDK
// reports a network failure without a status code). Exported for the checks.
export function isTemporaryResendError(error: { statusCode?: number | null } | null): boolean {
  if (!error) {
    return false;
  }
  const status = error.statusCode ?? null;
  return status === null || status === 429 || status >= 500;
}
