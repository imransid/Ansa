// Stand-ins for the Anthropic client, shared by the Claude adapter checks
// (claude-adapter-checks.ts, claude-adapter-plan-checks.ts): one that records
// what would have been sent, real clients whose fetch fails, asks to wait
// an hour or never answers, and ways to see when a request is cut off. No
// network: nothing here reaches Anthropic.

import type Anthropic from "@anthropic-ai/sdk";
import { createClaudeClient } from "@/adapters/claude";
import type { ModelRequest } from "@/lib/model-request";

export const REQUEST: ModelRequest = { systemPrompt: "fixed rules", prompt: "the slice", jsonSchema: { type: "object" } };

// maxDuration of both webhooks, the scheduled jobs, the call page, the
// Emails page, the Co-Founder's Interview, Profile and Strategy pages, the
// content studio's new draft and draft pages, and the calendar.
export const ROUTE_MAX_DURATION_MS = 300_000;
// The SDK waits at most this long between attempts by default.
const SDK_LONGEST_WAIT_BETWEEN_ATTEMPTS_MS = 8_000;

type SentRequest = { body: Record<string, unknown>; options: Record<string, unknown> };

// A stand-in client that records what would have been sent, and answers "{}".
export function recordingClient() {
  const sent: SentRequest[] = [];
  const create = async (body: Record<string, unknown>, options: Record<string, unknown>) => {
    sent.push({ body, options });
    return { stop_reason: "end_turn", content: [{ type: "text", text: "{}" }], usage: { input_tokens: 1, output_tokens: 1 } };
  };
  return { sent, client: { messages: { create } } as unknown as Anthropic };
}

// A real client whose every request fails with a 500, retried at once.
export function alwaysFailingClient() {
  const attempts = { count: 0 };
  const fetch = async () => {
    attempts.count += 1;
    const error = JSON.stringify({ type: "error", error: { type: "api_error", message: "overloaded" } });
    return new Response(error, { status: 500, headers: { "content-type": "application/json", "retry-after-ms": "1" } });
  };
  return { attempts, client: createClaudeClient("sk-ant-fake").withOptions({ fetch }) };
}

// A real client whose first answer is a 429 asking to wait an hour before the
// next attempt, which the SDK would do.
export function rateLimitedClient() {
  const attempts = { count: 0 };
  const fetch = async () => {
    attempts.count += 1;
    const error = JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow down" } });
    return new Response(error, { status: 429, headers: { "content-type": "application/json", "retry-after": "3600" } });
  };
  return { attempts, client: createClaudeClient("sk-ant-fake").withOptions({ fetch }) };
}

// A real client whose requests never get an answer: each waits until it is
// cut off (the signal the SDK hands to fetch is aborted).
export function neverAnsweringClient() {
  const attempts = { count: 0 };
  const fetch = (_url: RequestInfo | URL, init?: RequestInit) => {
    attempts.count += 1;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("The request was cut off", "AbortError")));
    });
  };
  return { attempts, client: createClaudeClient("sk-ant-fake").withOptions({ fetch }) };
}

// Runs `work` with every AbortSignal.timeout firing after 50 ms instead of
// minutes, and records the limits the code asked for.
export async function withShortenedTimeouts<T>(work: () => Promise<T>): Promise<{ result: T; askedMs: number[] }> {
  const realTimeout = AbortSignal.timeout;
  const askedMs: number[] = [];
  AbortSignal.timeout = (milliseconds: number) => {
    askedMs.push(milliseconds);
    return realTimeout(50);
  };
  try {
    return { result: await work(), askedMs };
  } finally {
    AbortSignal.timeout = realTimeout;
  }
}

// Fails after `ms` instead of hanging (for an hour) when nothing cuts the work off.
export async function failIfStillWaitingAfter<T>(ms: number, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const tooSlow = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`still waiting after ${ms} ms: the request was not cut off`)), ms);
  });
  try {
    return await Promise.race([work, tooSlow]);
  } finally {
    clearTimeout(timer);
  }
}

// The longest one request may take with these settings: every attempt
// running out of time, with the SDK's longest wait between attempts.
export function longestRunMs(settings: { timeoutMs: number; maxRetries: number }): number {
  return settings.timeoutMs * (settings.maxRetries + 1) + settings.maxRetries * SDK_LONGEST_WAIT_BETWEEN_ATTEMPTS_MS;
}
