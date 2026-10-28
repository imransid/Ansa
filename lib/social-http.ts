import "server-only";
import type { z } from "zod";
import { cutToLength } from "@/lib/cofounder/fact-proposals";
import { toPlainSingleLine } from "@/lib/plain-text";
import { readStreamWithLimit } from "@/lib/read-raw-body";
import type { PublishErrorCode } from "@/lib/social-errors";
import type { PublishResult, SocialFetch } from "@/lib/social-types";

// What every social adapter (step 40) does the same way: each request has
// its own time limit, follows no redirect, and is never cached; answers are
// read with a size cap and only through a Zod schema of the fields used;
// and nothing a platform wrote (its messages) is ever logged or kept.

// How long one call to a platform's API or token endpoint may take.
export const API_TIMEOUT_MS = 15_000;
// How long sending one image may take.
export const IMAGE_UPLOAD_TIMEOUT_MS = 60_000;

// Platforms answer in kilobytes; anything bigger is not an answer we use.
const MAX_ANSWER_BYTES = 1024 * 1024;

export type PlatformAnswer = { kind: "answered"; response: Response } | { kind: "no_answer"; code: "timeout" | "network_error" };

// Sends one request, cut off after timeoutMs (the body's reading too: the
// signal stays on the answer). redirect "manual": these APIs don't
// redirect, and a token must never follow one to another host.
export async function sendToPlatform(fetchFn: SocialFetch, url: string, init: RequestInit, timeoutMs: number): Promise<PlatformAnswer> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetchFn(url, { ...init, signal, redirect: "manual", cache: "no-store" });
    return { kind: "answered", response };
  } catch {
    // The error's message can name the host or the address: only its kind is kept.
    return { kind: "no_answer", code: signal.aborted ? "timeout" : "network_error" };
  }
}

// The JSON of an answer, through `schema`, or null when the body is
// missing, too large, cut off, not JSON or not of that shape.
export async function readJsonAnswer<T>(response: Response, schema: z.ZodType<T>): Promise<T | null> {
  try {
    const bytes = await readStreamWithLimit(response.body, response.headers.get("content-length"), MAX_ANSWER_BYTES);
    if (bytes === "too-large") {
      return null;
    }
    const parsed = schema.safeParse(JSON.parse(bytes.toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Lets go of an answer whose body isn't needed.
export async function discardAnswer(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

// The JSON of a 2xx answer through `schema`; null for no answer, a
// refusal (its body let go unread) or an unreadable body.
export async function readJsonIfOk<T>(answer: PlatformAnswer, schema: z.ZodType<T>): Promise<T | null> {
  if (answer.kind === "no_answer") {
    return null;
  }
  if (!answer.response.ok) {
    await discardAnswer(answer.response);
    return null;
  }
  return readJsonAnswer(answer.response, schema);
}

// A query string written the way the platforms' docs write it (a space as
// %20, so "openid profile" reads "openid%20profile").
export function toQueryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join("&");
}

// A form body (application/x-www-form-urlencoded), with its header.
export function formRequest(params: Record<string, string>, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(params).toString(),
  };
}

// "Basic <base64 of id:secret>", how X's token endpoint wants a confidential client.
export function basicAuthorization(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
}

// When a token runs out, from the answer's expires_in (seconds); null when
// the platform said nothing.
export function expiryFrom(expiresInSeconds: number | undefined, now: Date): Date | null {
  return expiresInSeconds === undefined ? null : new Date(now.getTime() + expiresInSeconds * 1000);
}

// The permissions a token answer names ("a b" or "a,b"), or what ansa asked
// for when it names none.
export function grantedScopes(scope: string | undefined, asked: readonly string[]): string[] {
  const named = (scope ?? "").split(/[\s,]+/).filter(Boolean);
  return [...new Set(named.length > 0 ? named : asked)].slice(0, 50);
}

// An account's name as the platform gave it, as one plain line of at most
// 200 characters; fallback when it gave none.
export function accountName(name: string | undefined, fallback: string): string {
  return cutToLength(toPlainSingleLine(name ?? ""), 200) || fallback;
}

// Seconds to wait, from a Retry-After header (seconds, or an HTTP date).
export function secondsFromRetryAfter(value: string | null, now: Date): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = /^\d+$/.test(value.trim()) ? Number(value.trim()) : (Date.parse(value) - now.getTime()) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined;
}

// Seconds until a moment given as seconds since 1970 (X's x-rate-limit-reset).
export function secondsUntilEpochSeconds(value: string | null, now: Date): number | undefined {
  if (!value || !/^\d+$/.test(value.trim())) {
    return undefined;
  }
  const seconds = Number(value.trim()) - now.getTime() / 1000;
  return seconds > 0 ? Math.ceil(seconds) : 1;
}

export function notCreated(code: PublishErrorCode, retryAfterSeconds?: number): PublishResult {
  return retryAfterSeconds === undefined ? { kind: "not_created", code } : { kind: "not_created", code, retryAfterSeconds };
}

export function unclear(code: PublishErrorCode): PublishResult {
  return { kind: "unclear", code };
}
