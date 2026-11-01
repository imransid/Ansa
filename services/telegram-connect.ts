import "server-only";
import { randomBytes } from "node:crypto";
import {
  connectStandInTelegram,
  createTelegramLinkCode,
  disconnectTelegram,
  getLiveTelegramConnection,
  type TelegramConnectionView,
} from "@/db/channel-connections";
import type { FormResult } from "@/lib/form-result";
import { canManageRestaurant } from "@/lib/restaurant-permissions";
import type { SessionContext } from "@/lib/session";
import { telegramStartLink } from "@/lib/telegram";
import { currentTelegramMode, telegramStandInsAllowed, type TelegramMode } from "@/lib/telegram-mode";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";
import { hashTelegramLinkCode } from "./telegram-updates";

// Settings → Connections (step 48): the company's Telegram account. Owners
// connect it through a one-time link to ansa's bot and disconnect it;
// members read it. Checked here and again in /db.

export type ChannelsPage = {
  canManage: boolean;
  telegramMode: TelegramMode["kind"];
  telegram: TelegramConnectionView | null;
};

export type ConnectLinkResult = { ok: true; link: string } | { ok: false; errors: { message: string } };

// What Settings → Connections shows the session's person.
export async function getChannelsPageForSession(session: SessionContext): Promise<ChannelsPage> {
  return {
    canManage: canManageRestaurant(session.role),
    telegramMode: currentTelegramMode().kind,
    telegram: await getLiveTelegramConnection(session.companyId),
  };
}

// Makes a one-time link that opens ansa's bot with a new code (10 minutes).
// The code itself goes only into the link; its hash is stored.
export async function startTelegramConnectForSession(session: SessionContext, mode: TelegramMode = currentTelegramMode()): Promise<ConnectLinkResult> {
  if (!canManageRestaurant(session.role)) {
    return refused("Only owners connect Telegram.");
  }
  if (mode.kind !== "real") {
    return refused("Telegram isn't set up by ansa yet.");
  }
  if (await isOverRateLimit("settings-changes", session.userId, RATE_LIMITS.settingsChangesPerUser)) {
    return refused("Too many changes. Try again in a few minutes.");
  }
  const code = randomBytes(32).toString("base64url");
  const outcome = await createTelegramLinkCode(session.companyId, session.userId, hashTelegramLinkCode(code));
  if (outcome === "not-allowed") {
    return refused("Only owners connect Telegram.");
  }
  return { ok: true, link: telegramStartLink(mode.bot.username, code) };
}

// Development without ansa's bot: connects a stand-in Telegram account.
export async function connectStandInTelegramForSession(session: SessionContext, mode: TelegramMode = currentTelegramMode()): Promise<FormResult> {
  if (!canManageRestaurant(session.role)) {
    return refused("Only owners connect Telegram.");
  }
  if (mode.kind !== "stand-in" || !telegramStandInsAllowed()) {
    return refused("A stand-in account is only for development without ansa's bot.");
  }
  if (await isOverRateLimit("settings-changes", session.userId, RATE_LIMITS.settingsChangesPerUser)) {
    return refused("Too many changes. Try again in a few minutes.");
  }
  const outcome = await connectStandInTelegram(session.companyId, session.userId);
  if (outcome === "exists") {
    return refused("A Telegram account is already connected.");
  }
  return outcome === "saved" ? { ok: true } : refused("Only owners connect Telegram.");
}

// Disconnects the company's Telegram account in ansa.
export async function disconnectTelegramForSession(session: SessionContext): Promise<FormResult> {
  if (!canManageRestaurant(session.role)) {
    return refused("Only owners disconnect Telegram.");
  }
  if (await isOverRateLimit("settings-changes", session.userId, RATE_LIMITS.settingsChangesPerUser)) {
    return refused("Too many changes. Try again in a few minutes.");
  }
  const outcome = await disconnectTelegram(session.companyId, session.userId);
  if (outcome === "not-allowed") {
    return refused("Only owners disconnect Telegram.");
  }
  return { ok: true };
}

function refused(message: string): { ok: false; errors: { message: string } } {
  return { ok: false, errors: { message } };
}
