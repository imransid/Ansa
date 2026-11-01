import "server-only";
import { callCore, type CoreAnswer } from "@/lib/core-api";
import { toFormErrors } from "@/lib/core-views/auth";
import type { FormErrors, FormResult } from "@/lib/form-result";
import type { CompanyKind } from "@/lib/restaurant-setup";
import type { TelegramMode } from "@/lib/telegram-mode";

// Settings → Connections through the new backend (core's /api/v1/channels
// and, for Facebook only, /api/v1/social), in the shapes the page and its
// actions already read.

// What the Connections page shows, whichever backend read it.
export type ConnectionsPage = {
  canManage: boolean;
  telegramMode: TelegramMode["kind"];
  telegram: {
    displayName: string;
    status: "connected" | "cannot_reply" | "removed_in_telegram";
    isStandIn: boolean;
    connectedAt: Date;
  } | null;
  kind: CompanyKind;
  forwardingAddress: string;
  lastEmailAt: Date | null;
  phoneLines: { id: string; lastCallAt: Date | null }[];
};

// Facebook Messenger as the new backend reads it: whether ansa's Meta app is
// set up here, and the company's Facebook Pages (canMessage: their messages
// come to ansa).
export type CoreMessenger = {
  mode: "real" | "stand-in" | "not-set-up";
  pages: { id: string; displayName: string; status: string; isStandIn: boolean; canMessage: boolean }[];
};

type CoreChannels = {
  page: {
    telegram: { displayName: string; status: NonNullable<ConnectionsPage["telegram"]>["status"]; isStandIn: boolean; connectedAt: string } | null;
    facebookPages: CoreMessenger["pages"];
    forwardingAddress: string;
    lastEmailAt: string | null;
    phoneLines: { id: string; lastCallAt: string | null }[];
  };
  canManage: boolean;
  telegramMode: TelegramMode["kind"];
  facebookMode: CoreMessenger["mode"];
};

function dateOrNull(iso: string | null): Date | null {
  return iso ? new Date(iso) : null;
}

function savedOrErrors(answer: CoreAnswer<unknown>): FormResult {
  return answer.ok ? { ok: true } : { ok: false, errors: toFormErrors(answer) };
}

// Telegram, Facebook Messenger, email forwarding and phone lines (core's
// channels page), and whether the account is a business or one person
// (core's setup).
export async function getConnectionsFromCore(): Promise<ConnectionsPage & { messenger: CoreMessenger }> {
  const [channels, setup] = await Promise.all([
    callCore<CoreChannels>("GET", "/api/v1/channels"),
    callCore<{ profile: { kind: string } }>("GET", "/api/v1/setup"),
  ]);
  if (!channels.ok) {
    throw new Error(`Core answered ${channels.status}`);
  }
  if (!setup.ok) {
    throw new Error(`Core answered ${setup.status}`);
  }
  const { page } = channels.data;
  return {
    canManage: channels.data.canManage,
    telegramMode: channels.data.telegramMode,
    telegram: page.telegram ? { ...page.telegram, connectedAt: new Date(page.telegram.connectedAt) } : null,
    kind: setup.data.profile.kind === "personal" ? "personal" : "business",
    forwardingAddress: page.forwardingAddress,
    lastEmailAt: dateOrNull(page.lastEmailAt),
    phoneLines: page.phoneLines.map((line) => ({ id: line.id, lastCallAt: dateOrNull(line.lastCallAt) })),
    messenger: { mode: channels.data.facebookMode, pages: page.facebookPages },
  };
}

// "Connect Telegram": a one-time link to ansa's bot, for the page to open.
export async function startTelegramConnectThroughCore(): Promise<{ ok: true; link: string } | { ok: false; errors: FormErrors }> {
  const answer = await callCore<{ link: string }>("POST", "/api/v1/channels/telegram/link");
  return answer.ok ? { ok: true, link: answer.data.link } : { ok: false, errors: toFormErrors(answer) };
}

// Development without ansa's bot: a stand-in Telegram account.
export async function connectStandInTelegramThroughCore(): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", "/api/v1/channels/telegram/stand-in"));
}

export async function disconnectTelegramThroughCore(): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", "/api/v1/channels/telegram/disconnect"));
}

// "Connect Facebook Page": the address of Facebook's consent screen.
export async function startFacebookConnectThroughCore(): Promise<{ ok: true; url: string } | { ok: false; errors: FormErrors }> {
  const answer = await callCore<{ url: string }>("POST", "/api/v1/social/facebook/connect");
  return answer.ok ? { ok: true, url: answer.data.url } : { ok: false, errors: toFormErrors(answer) };
}

// Development without ansa's Meta app: the stand-in Page.
export async function connectFacebookStandInThroughCore(): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", "/api/v1/social/facebook/stand-in"));
}

// Disconnects one of the company's Facebook Pages. "not-facebook": core
// found no Facebook Page of the company with that id (another platform's
// account, which services/ disconnects, or none at all).
export async function disconnectFacebookPageThroughCore(connectionId: unknown): Promise<FormResult | "not-facebook"> {
  const id = typeof connectionId === "string" ? connectionId : "";
  const answer = await callCore("POST", `/api/v1/social/connections/${encodeURIComponent(id)}/disconnect`);
  if (!answer.ok && answer.status === 404) {
    return "not-facebook";
  }
  return savedOrErrors(answer);
}

// The owner's return from Facebook's consent screen: core finishes it and
// names the Accounts page address (with its result code) to send them to.
export async function finishFacebookConnectionThroughCore(query: URLSearchParams): Promise<Response> {
  // URLSearchParams writes the query fully encoded, so fetch sends it as
  // signed (core checks the signature on the address it receives).
  const answer = await callCore<{ location: string }>("GET", `/api/v1/social/facebook/callback?${query.toString()}`);
  const location = answer.ok ? answer.data.location : "/cofounder/accounts?result=exchange_failed&platform=facebook";
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}
