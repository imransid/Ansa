import "server-only";
import { z } from "zod";
import { emptyMetricValues, METRIC_VALUE_MAX, type PostMetricValues } from "@/lib/metric-definitions";
import type { MetricsErrorCode } from "@/lib/metrics-errors";
import type { MetricsResult } from "@/lib/social-types";

// What every adapter's fetchPostMetrics (step 42) does the same way: a
// count is a whole number ansa can keep, or the answer is unreadable (never
// guessed or cut); a number the platform left out stays null; an answer
// without a single number is no snapshot at all.

// A count as a platform writes it: a whole number from 0 to Postgres's integer.
export const countSchema = z.number().int().min(0).max(METRIC_VALUE_MAX);

// YouTube writes its counts as strings of digits.
export const countTextSchema = z
  .string()
  .regex(/^\d{1,10}$/)
  .transform(Number)
  .pipe(countSchema);

// The numbers read, the rest null; "no_numbers" when the platform gave none.
export function collectedOrNothing(values: Partial<PostMetricValues>): MetricsResult {
  const all = { ...emptyMetricValues(), ...values };
  const hasAny = Object.values(all).some((value) => value !== null);
  return hasAny ? { kind: "collected", values: all } : { kind: "failed", code: "no_numbers" };
}

// Two counts added up, or null unless the platform gave both.
export function sumOfBoth(first: number | undefined, second: number | undefined): number | null {
  if (first === undefined || second === undefined || first + second > METRIC_VALUE_MAX) {
    return null;
  }
  return first + second;
}

// What a refusal means, by its HTTP status (X and YouTube; Facebook names
// its own codes). A 401 is the token itself: the collector marks the
// account as needing a reconnect, as publishing does.
export function metricsFailureForStatus(status: number): MetricsErrorCode {
  if (status === 401) {
    return "token_rejected";
  }
  if (status === 403) {
    return "permission_denied";
  }
  if (status === 404) {
    return "not_found";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status === 400) {
    return "invalid_request";
  }
  return status >= 500 ? "server_error" : "unexpected_answer";
}

export function metricsFailed(code: MetricsErrorCode): MetricsResult {
  return { kind: "failed", code };
}
