import "server-only";
import { callCore, type CoreAnswer } from "@/lib/core-api";
import { toFormErrors } from "@/lib/core-views/auth";
import type { FormErrors, FormResult } from "@/lib/form-result";
import type { CompanyKind } from "@/lib/restaurant-setup";

// How ansa's Telegram bot stands, as core says: its bot set, the
// development stand-in, or not set up (production without the bot).
type TelegramModeKind = "real" | "stand-in" | "not-set-up";

// Settings → Connections through the new backend (core's /api/v1/channels),
// in the shapes the page and its actions already read. Connecting and
// disconnecting a social account (Facebook's Pages too) is
// lib/core-views/accounts.ts.

// WhatsApp Business (step 56): the company's number as core reads it, and
// what the page needs to open Meta's sign-up window (only once ansa's Meta
// app is set up for it: public values, Meta's script shows them to anyone).
export type WhatsAppNumber = {
  displayPhoneNumber: string;
  verifiedName: string | null;
  status: "connected" | "removed_in_whatsapp";
  sharedWithApp: boolean;
  isStandIn: boolean;
  connectedAt: Date;
};
export type WhatsAppSignup = { appId: string; configId: string };

// What the Connections page shows, whichever backend read it.
export type ConnectionsPage = {
  canManage: boolean;
  telegramMode: TelegramModeKind;
  whatsappMode: TelegramModeKind;
  whatsapp: WhatsAppNumber | null;
  whatsappSignup: WhatsAppSignup | null;
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
  // The company's package includes Messenger (step 57).
  inPackage: boolean;
  pages: { id: string; displayName: string; status: string; isStandIn: boolean; canMessage: boolean }[];
};

type CoreChannels = {
  page: {
    telegram: { displayName: string; status: NonNullable<ConnectionsPage["telegram"]>["status"]; isStandIn: boolean; connectedAt: string } | null;
    whatsapp: (Omit<WhatsAppNumber, "connectedAt"> & { connectedAt: string }) | null;
    facebookPages: CoreMessenger["pages"];
    forwardingAddress: string;
    lastEmailAt: string | null;
    phoneLines: { id: string; lastCallAt: string | null }[];
  };
  canManage: boolean;
  telegramMode: TelegramModeKind;
  facebookMode: CoreMessenger["mode"];
  whatsappMode: TelegramModeKind;
  whatsappSignup: WhatsAppSignup | null;
  messengerInPackage: boolean;
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
    whatsappMode: channels.data.whatsappMode,
    whatsapp: page.whatsapp ? { ...page.whatsapp, connectedAt: new Date(page.whatsapp.connectedAt) } : null,
    whatsappSignup: channels.data.whatsappSignup,
    kind: setup.data.profile.kind === "personal" ? "personal" : "business",
    forwardingAddress: page.forwardingAddress,
    lastEmailAt: dateOrNull(page.lastEmailAt),
    phoneLines: page.phoneLines.map((line) => ({ id: line.id, lastCallAt: dateOrNull(line.lastCallAt) })),
    messenger: { mode: channels.data.facebookMode, inPackage: channels.data.messengerInPackage, pages: page.facebookPages },
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

// "Connect WhatsApp": what Meta's sign-up window reported (claims: core
// checks each with Meta, server to server, before saving anything).
export async function connectWhatsAppThroughCore(signup: { code: string; wabaId: string; phoneNumberId: string }): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", "/api/v1/channels/whatsapp/connect", signup));
}

// Development without ansa's Meta app: a stand-in WhatsApp number.
export async function connectStandInWhatsAppThroughCore(): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", "/api/v1/channels/whatsapp/stand-in"));
}

export async function disconnectWhatsAppThroughCore(): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", "/api/v1/channels/whatsapp/disconnect"));
}
