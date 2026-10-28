// Shared pieces for the social account checks (step 40): fake platforms
// that record every request and answer from a script, each platform's
// modes with made-up apps, a full Connect -> callback round as the browser
// makes it, and what the database holds. No real platform is ever asked:
// every fetch here is a fake (local-only.ts also refuses real apps).

import assert from "node:assert/strict";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { oauthStates, socialConnections } from "@/db/schema";
import type { SessionContext } from "@/lib/session";
import type { PlatformMode } from "@/lib/social-mode";
import type { SocialPlatform } from "@/lib/social-platforms";
import type { PublishResult, SocialFetch } from "@/lib/social-types";
import { startSocialConnectionForSession } from "@/services/social-connect";
import { handleSocialCallback } from "@/services/social-oauth-callback";
import type { SocialOptions } from "@/services/social-options";
import { runId } from "./helpers";

// One request as a platform got it.
export type RecordedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: RequestInit["body"];
  hadTimeLimit: boolean;
};

type Answer = Response | ((request: RecordedRequest) => Response | Promise<Response>);

// A fake platform: answers each request with the next of `answers` (a 500
// once they run out), recording what it was asked, headers lowercased.
export function fakePlatform(answers: Answer[]) {
  const requests: RecordedRequest[] = [];
  const fetchFn: SocialFetch = async (url, init) => {
    const headers = Object.fromEntries([...new Headers(init.headers).entries()]);
    const request = { url, method: init.method ?? "GET", headers, body: init.body, hadTimeLimit: init.signal instanceof AbortSignal };
    requests.push(request);
    const next = answers.shift() ?? new Response(null, { status: 500 });
    return typeof next === "function" ? next(request) : next;
  };
  return { fetchFn, requests };
}

// A platform that must not be asked: every request fails (a network error
// to the adapter), so a check expecting no request gets another outcome.
export const noPlatform: SocialFetch = async (url) => {
  throw new Error(`a platform was asked (${new URL(url).host}) where none should be`);
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

// The made-up app of one platform.
export function fakeCredentials(platform: SocialPlatform) {
  return { clientId: `client-${platform}-${runId}`, clientSecret: `app-secret-${platform}-${runId}` };
}

// Every platform set up with its made-up app ("real", answered by fakes).
export const everyPlatformReal = (platform: SocialPlatform): PlatformMode => ({ kind: "real", credentials: fakeCredentials(platform) });
export const everyPlatformStandIn = (): PlatformMode => ({ kind: "stand-in" });
export const nothingSetUp = (): PlatformMode => ({ kind: "not-set-up" });

// An X account or YouTube channel id no other check's company connects.
// WHY: a Disconnect doesn't have X or Google revoke while another company
// still has the same account connected (services/social-disconnect.ts), so
// a check that expects a revoke connects an account of its own.
let accountsMade = 0;
export function ownXAccountId(): string {
  accountsMade += 1;
  return `${parseInt(runId, 16)}${accountsMade}`;
}
export function ownYouTubeChannelId(): string {
  accountsMade += 1;
  return `UC${runId}${accountsMade}`;
}

// A successful round with each platform, as its fakes answer it: the token
// endpoint, then who the account is.
export function linkedInConnects(sub = `member${runId}`, name = "Ana Baker") {
  return [json({ access_token: `li-access-${runId}`, expires_in: 5184000, scope: "openid,profile,w_member_social" }), json({ sub, name })];
}

export function xConnects(id = "1234567890", username = "ansabakery") {
  const tokens = { token_type: "bearer", expires_in: 7200, access_token: `x-access-${runId}`, refresh_token: `x-refresh-${runId}`, scope: "tweet.read tweet.write users.read offline.access media.write" };
  return [json(tokens), json({ data: { id, name: "Ansa Bakery", username } })];
}

// refreshEndsInSeconds: Google's refresh_token_expires_in (7 days while an
// app is in Testing); left out, the refresh token has no known end.
export function youTubeConnects(channelId = "UCabcdefghijklmnopqrstuv", refreshEndsInSeconds?: number) {
  const scope = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly";
  const tokens = { access_token: `yt-access-${runId}`, expires_in: 3599, refresh_token: `yt-refresh-${runId}`, refresh_token_expires_in: refreshEndsInSeconds, scope, token_type: "Bearer" };
  return [json(tokens), json({ items: [{ id: channelId, snippet: { title: "Ansa Bakery TV" } }] })];
}

type FacebookPage = { id: string; name: string; tasks: string[] };

export function facebookConnects(pages: FacebookPage[], granted = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "public_profile"]) {
  return [
    json({ access_token: `fb-short-${runId}`, token_type: "bearer", expires_in: 5000 }),
    json({ access_token: `fb-long-${runId}`, token_type: "bearer", expires_in: 5183944 }),
    json({ data: granted.map((permission) => ({ permission, status: "granted" })) }),
    json({ data: pages.map((page) => ({ ...page, access_token: `fb-page-${page.id}-${runId}` })) }),
  ];
}

// Connect as the Accounts page does: the state and PKCE challenge the
// browser is sent to the platform with.
export async function startConnecting(session: SessionContext, platform: SocialPlatform, options: SocialOptions = { modeOf: everyPlatformReal }) {
  const started = await startSocialConnectionForSession(session, { platform }, options);
  assert.ok(started.ok, JSON.stringify(started));
  const url = new URL(started.url);
  return { url, state: url.searchParams.get("state") ?? "", challenge: url.searchParams.get("code_challenge") };
}

// The platform sends the browser back: the address our callback answers with.
export async function comeBack(session: SessionContext | null, platform: string, query: Record<string, string>, options: SocialOptions): Promise<string> {
  const answer = await handleSocialCallback(session, platform, new URLSearchParams(query), options);
  assert.equal(answer.status, 303, `the callback answered ${answer.status}`);
  return answer.headers.get("location") ?? "";
}

// Connect and come back with a code: one full round. Returns where the browser lands.
export async function connectFully(session: SessionContext, platform: SocialPlatform, answers: Answer[]) {
  const { state } = await startConnecting(session, platform);
  const platformFake = fakePlatform(answers);
  const landing = await comeBack(session, platform, { state, code: `code-${runId}` }, { modeOf: everyPlatformReal, fetchFn: platformFake.fetchFn });
  return { landing, requests: platformFake.requests };
}

export async function connectionRows(companyId: string) {
  return db.select().from(socialConnections).where(eq(socialConnections.companyId, companyId));
}

export async function stateRows(companyId: string) {
  return db.select().from(oauthStates).where(eq(oauthStates.companyId, companyId));
}

// The stand-in posts a check wrote (.dev-social/<platform>/<time>-<id>.json),
// by the dev id publishing answered with ("dev-<id>").
export const standInPostFiles: string[] = [];

// Notes the file a stand-in publish wrote, if it wrote one, right away (so
// it is removed even when the check then fails), and returns its name.
export async function trackStandInPost(platform: SocialPlatform, result: PublishResult): Promise<string | null> {
  if (result.kind !== "published") {
    return null;
  }
  const id = result.externalPostId.replace("dev-", "");
  const folder = path.join(process.cwd(), ".dev-social", platform);
  const fileName = (await readdir(folder).catch(() => [] as string[])).find((name) => name.endsWith(`-${id}.json`)) ?? null;
  if (fileName) {
    standInPostFiles.push(path.join(platform, fileName));
  }
  return fileName;
}

export async function removeStandInPostFiles(): Promise<void> {
  for (const file of standInPostFiles.splice(0)) {
    await rm(path.join(process.cwd(), ".dev-social", file), { force: true });
  }
}
