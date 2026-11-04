// Checking core's answers before the screens use them: an answer of another
// shape (an older or newer core, a proxy's error page) is treated as "ansa
// couldn't answer", never shown half-read.
import type { ActivityLine, HomeAnswer, PairAnswer, Status, StatusAnswer } from "./types";

type Unknown = Record<string, unknown>;

function isObject(value: unknown): value is Unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

export function readStatus(value: unknown): Status | null {
  if (!isObject(value)) return null;
  const { accountName, kind, state, awayBy, since, answersAlways, followPhone, waitMinutes } = value;
  if (typeof accountName !== "string") return null;
  if (!isOneOf(kind, ["business", "personal"] as const)) return null;
  if (!isOneOf(state, ["available", "away", "paused"] as const)) return null;
  if (!isOneOf(awayBy, ["", "you", "phone", "hours"] as const)) return null;
  if (typeof since !== "string" || typeof answersAlways !== "boolean" || typeof followPhone !== "boolean") return null;
  if (typeof waitMinutes !== "number") return null;
  return { accountName, kind, state, awayBy, since, answersAlways, followPhone, waitMinutes };
}

export function readStatusAnswer(value: unknown): StatusAnswer | null {
  if (!isObject(value)) return null;
  const status = readStatus(value.status);
  return status ? { status } : null;
}

export function readPairAnswer(value: unknown): PairAnswer | null {
  if (!isObject(value)) return null;
  const status = readStatus(value.status);
  const { token, deviceId } = value;
  if (!status || typeof token !== "string" || token === "" || typeof deviceId !== "string") return null;
  return { token, deviceId, status };
}

export function readHomeAnswer(value: unknown): HomeAnswer | null {
  if (!isObject(value)) return null;
  const status = readStatus(value.status);
  if (!status || typeof value.needsYou !== "number" || !Array.isArray(value.activity)) return null;
  const activity = value.activity.map(readActivityLine).filter((line): line is ActivityLine => line !== null);
  return { status, needsYou: value.needsYou, activity };
}

// A line that can't be read is left out; the others still show.
function readActivityLine(value: unknown): ActivityLine | null {
  if (!isObject(value)) return null;
  const { at, text, who } = value;
  if (typeof at !== "string" || typeof text !== "string") return null;
  return { at, text, who: typeof who === "string" ? who : "" };
}
