import "server-only";
import { callCore, type CoreAnswer } from "@/lib/core-api";
import { toFormErrors } from "@/lib/core-views/auth";
import type { FormErrors, FormResult } from "@/lib/form-result";
import type { CompanyKind } from "@/lib/restaurant-setup";
import type { TelegramMode } from "@/lib/telegram-mode";

// Settings → Connections through the new backend (core's /api/v1/channels),
// in the shapes the page and its actions already read. Connecting and
// disconnecting a social account (Facebook's Pages too) is
// lib/core-views/accounts.ts.

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
