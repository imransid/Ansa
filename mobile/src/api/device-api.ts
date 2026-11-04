// The phone app's only door to ansa: core's device API (POST /device/v1/pair,
// /heartbeat, /away, /unpair and GET /home). The app makes no other network
// call. Every call but pairing carries the phone's token.
import { readHomeAnswer, readPairAnswer, readStatusAnswer } from "./read-answers";
import type { HomeAnswer, PairAnswer, Platform, StatusAnswer } from "./types";

// How long the app waits for core before saying it can't reach it.
const REQUEST_TIMEOUT_MS = 15_000;

// Why a call didn't work, so each screen can say the right thing:
// - offline: no answer at all (no internet, wrong address, core down);
// - unauthorized: core doesn't know this phone any more (removed on the
//   website, or disconnected): the app forgets its token;
// - refused: core said no, with words for a person (a wrong code, too many tries);
// - server: core answered with an error or something the app can't read.
export type DeviceApiErrorKind = "offline" | "unauthorized" | "refused" | "server";

export class DeviceApiError extends Error {
  readonly kind: DeviceApiErrorKind;

  constructor(kind: DeviceApiErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

const OFFLINE_MESSAGE = "Can't reach ansa. Check your internet.";
const SERVER_MESSAGE = "ansa couldn't answer just now. Try again in a moment.";

// Connects this phone with the code from ansa's website.
export async function pairPhone(serverUrl: string, request: { code: string; name: string; platform: Platform }): Promise<PairAnswer> {
  const answer = await callDevice(serverUrl, "POST", "/device/v1/pair", null, request);
  return readOrFail(readPairAnswer(answer));
}

// The check-in: tells ansa this phone is reachable, and hears what ansa does now.
export async function checkIn(serverUrl: string, token: string): Promise<StatusAnswer> {
  const answer = await callDevice(serverUrl, "POST", "/device/v1/heartbeat", token, {});
  return readOrFail(readStatusAnswer(answer));
}

// Everything Home shows: the status, what needs the person, what ansa did.
export async function loadHome(serverUrl: string, token: string): Promise<HomeAnswer> {
  const answer = await callDevice(serverUrl, "GET", "/device/v1/home", token, null);
  return readOrFail(readHomeAnswer(answer));
}

// "I'm away" (true) or "I'm back" (false), recorded as the person's own.
export async function setAway(serverUrl: string, token: string, away: boolean): Promise<StatusAnswer> {
  const answer = await callDevice(serverUrl, "POST", "/device/v1/away", token, { away });
  return readOrFail(readStatusAnswer(answer));
}

// Removes this phone from the account.
export async function unpairPhone(serverUrl: string, token: string): Promise<void> {
  await callDevice(serverUrl, "POST", "/device/v1/unpair", token, {});
}

function readOrFail<T>(answer: T | null): T {
  if (answer === null) throw new DeviceApiError("server", SERVER_MESSAGE);
  return answer;
}

// One request to core, with a time limit. Returns the parsed JSON (null for
// an empty answer), or throws a DeviceApiError.
async function callDevice(serverUrl: string, method: "GET" | "POST", path: string, token: string | null, body: object | null): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== null) headers["Content-Type"] = "application/json";
  if (token !== null) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${serverUrl}${path}`, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new DeviceApiError("offline", OFFLINE_MESSAGE);
  } finally {
    clearTimeout(timer);
  }
  return readResponse(response);
}

async function readResponse(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  const json = parseJson(text);
  if (response.status === 401) throw new DeviceApiError("unauthorized", "This phone isn't connected to ansa any more.");
  if (response.status >= 400 && response.status < 500) throw new DeviceApiError("refused", errorWords(json) ?? SERVER_MESSAGE);
  if (!response.ok) throw new DeviceApiError("server", SERVER_MESSAGE);
  return json;
}

function parseJson(text: string): unknown {
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Core's own words for a refusal: {"error": "..."}.
function errorWords(json: unknown): string | null {
  if (typeof json !== "object" || json === null) return null;
  const words = (json as { error?: unknown }).error;
  return typeof words === "string" && words.trim() !== "" ? words : null;
}
