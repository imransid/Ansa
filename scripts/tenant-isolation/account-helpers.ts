// Shared pieces for the signup, verification, takeover, password reset and
// account checks: the emails the dev outbox wrote for an account, the
// account's state, and request headers for calling the services the way a
// browser request would.

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { KNOWN_DEVICE_COOKIE_NAME } from "@/lib/known-device";
import { runId } from "./helpers";

const OUTBOX = path.join(process.cwd(), ".dev-emails");

// Named after the idempotency keys in services/email-verification.ts and
// services/password-reset-email.ts.
type AccountEmailKind = "verify-email" | "existing-account" | "reset-password";

// The outbox files of one kind for one account. File names start with the
// time they were written, so after sorting the newest is last.
export async function accountEmailFiles(kind: AccountEmailKind, userId: string): Promise<string[]> {
  const files = await readdir(OUTBOX).catch(() => [] as string[]);
  return files.filter((file) => file.includes(`${kind}-${userId}-`)).sort();
}

export async function readOutboxFile(fileName: string): Promise<string> {
  return readFile(path.join(OUTBOX, fileName), "utf8");
}

// The token from the newest "confirm your email" link sent to this account,
// read from the email itself, as the person who owns the inbox would.
export async function newestVerificationToken(userId: string): Promise<string> {
  const files = await accountEmailFiles("verify-email", userId);
  assert.ok(files.length > 0, "no verification email was written");
  const email = await readOutboxFile(files[files.length - 1]);
  const link = email.match(/\/verify-email#([A-Za-z0-9_.-]+)/);
  assert.ok(link, "the verification email has no link");
  return link[1];
}

// The token from the newest reset link sent to this account, read from the
// email itself, as the person who owns the inbox would.
export async function newestResetToken(userId: string): Promise<string> {
  const tokens = await allResetTokens(userId);
  return tokens[tokens.length - 1];
}

// The tokens of every reset link sent to this account, oldest first (emails
// written in the same millisecond may come in either order).
export async function allResetTokens(userId: string): Promise<string[]> {
  const files = await accountEmailFiles("reset-password", userId);
  assert.ok(files.length > 0, "no reset email was written");
  const tokens: string[] = [];
  for (const file of files) {
    const link = (await readOutboxFile(file)).match(/\/reset-password#([A-Za-z0-9]+)/);
    assert.ok(link, "the reset email has no link");
    tokens.push(link[1]);
  }
  return tokens;
}

// What a takeover would change: the address, whether it is confirmed, and
// how many sessions (logins) the account has.
export async function accountState(userId: string) {
  const [user] = await db.select({ email: users.email, verified: users.emailVerified }).from(users).where(eq(users.id, userId));
  const userSessions = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId));
  return { email: user.email, verified: user.verified, sessions: userSessions.length };
}

export async function sessionIdsOf(userId: string): Promise<string[]> {
  const userSessions = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId));
  return userSessions.map((session) => session.id).sort();
}

export async function userIdsWithEmail(email: string): Promise<string[]> {
  const matches = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  return matches.map((user) => user.id);
}

// Headers of a request from a client address unique to this run and label,
// so the per-IP rate limits of one check (or an earlier run) never trip another.
export function requestHeadersFrom(label: string): Headers {
  return new Headers({ "x-forwarded-for": `isolation-${runId}-${label}` });
}

// The same, from a browser that holds this known-device cookie.
export function requestHeadersWithKnownDevice(label: string, knownDeviceCookie: string): Headers {
  const browserHeaders = requestHeadersFrom(label);
  browserHeaders.set("cookie", `${KNOWN_DEVICE_COOKIE_NAME}=${knownDeviceCookie}`);
  return browserHeaders;
}

// For checks that don't look at the known-device cookie a login hands out.
export function ignoreKnownDeviceCookie(): void {}

// Logs in the way the login form does and returns the headers that browser
// sends from then on: its client address and its session cookie.
export async function logInBrowser(email: string, password: string, clientLabel: string): Promise<Headers> {
  const browserHeaders = requestHeadersFrom(clientLabel);
  const { headers } = await auth.api.signInEmail({ body: { email, password }, headers: browserHeaders, returnHeaders: true });
  const sessionCookie = headers
    .getSetCookie()
    .find((cookie) => cookie.includes("better-auth.session_token="))
    ?.split(";")[0];
  assert.ok(sessionCookie, "the login set no session cookie");
  browserHeaders.set("cookie", sessionCookie);
  return browserHeaders;
}

// Says whether the session cookie in these headers still logs anyone in.
export async function isLoggedIn(browserHeaders: Headers): Promise<boolean> {
  return (await auth.api.getSession({ headers: browserHeaders })) !== null;
}

// Runs the work a service handed to runAfterResponse, as Next.js's after()
// would once the response has gone.
export async function runAfterResponseTasks(tasks: Array<() => Promise<void>>): Promise<void> {
  for (const task of tasks) {
    await task();
  }
}

// Better Auth's answer when a correct password belongs to an unconfirmed account.
export function isEmailNotVerifiedError(error: unknown): boolean {
  const code = (error as { body?: { code?: string } } | null)?.body?.code;
  return code === "EMAIL_NOT_VERIFIED";
}
