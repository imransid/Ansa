import "server-only";
import { sendTelegramMessage } from "@/adapters/telegram";
import { getAssistantSettings } from "@/db/assistant-settings";
import { telegramAlertChat } from "@/db/channel-connections";
import { listOwnersToAlert } from "@/db/owner-contacts";
import { getCompanySetup } from "@/db/restaurant-setup";
import type { HandoverReason } from "@/lib/assistant/reasons";
import { CHANNEL_LABELS, type ConversationChannel } from "@/lib/conversations";
import { needsYouTelegramNote, renderNeedsYouEmail } from "@/lib/emails/needs-you";
import type { RenderedEmail } from "@/lib/emails/ticket-solved";
import { env } from "@/lib/env";
import { describeErrorWithFrames } from "@/lib/safe-error-logging";
import { buildFromHeader, sendEmail } from "@/lib/send-email";
import type { SocialFetch } from "@/lib/social-types";
import { currentTelegramMode, type TelegramMode } from "@/lib/telegram-mode";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// Tells the restaurant's owners that a conversation needs them (step 49),
// after the handover is saved: an email to each owner while "alert by
// email" is on, and a note from ansa's bot in the restaurant's own Telegram
// when it is connected. Best effort: a failure is logged (fixed text) and
// never undoes the handover. Never the customer's messages.

export type NeedsYouAlert = {
  companyId: string;
  conversationId: string;
  triggerMessageId: string;
  channel: ConversationChannel;
  customerName: string | null;
  reason: HandoverReason;
  holdingReplySent: boolean;
};

// Only the checks pass these: Telegram's mode and a fake fetch.
export type AlertOptions = { telegramMode?: TelegramMode; fetchFn?: SocialFetch };

export async function alertOwners(alert: NeedsYouAlert, options: AlertOptions = {}): Promise<void> {
  try {
    if (await isOverRateLimit("owner-alerts", alert.companyId, RATE_LIMITS.ownerAlertsPerCompany)) {
      console.warn("Owner alert skipped: hourly limit");
      return;
    }
    const link = `${env.BETTER_AUTH_URL}/inbox/${alert.conversationId}`;
    const fields = { customerName: alert.customerName, channelLabel: CHANNEL_LABELS[alert.channel], reason: alert.reason, holdingReplySent: alert.holdingReplySent, link };
    await emailOwners(alert.companyId, `needs-you-${alert.triggerMessageId}`, (ownerName) => renderNeedsYouEmail({ ownerName, ...fields }));
    await noteInTelegram(alert.companyId, needsYouTelegramNote(fields), options);
  } catch (error) {
    console.error(`Owner alert failed: ${describeErrorWithFrames(error)}`);
  }
}

// One email to each confirmed, active owner while "alert by email" is on.
// `key`: the alert's own idempotency key, each owner's own added.
export async function emailOwners(companyId: string, key: string, render: (ownerName: string) => RenderedEmail): Promise<void> {
  const settings = await getAssistantSettings(companyId);
  if (settings && !settings.alertByEmail) {
    return;
  }
  const company = await getCompanySetup(companyId);
  for (const owner of await listOwnersToAlert(companyId)) {
    const result = await sendEmail({
      from: buildFromHeader(company.companyName),
      to: owner.email,
      replyTo: null,
      ...render(owner.name),
      idempotencyKey: `${key}-${owner.id}`,
    });
    if (!result.ok) {
      console.error("Could not send an owner alert email");
    }
  }
}

// A note from ansa's bot in the restaurant's own Telegram, when connected.
export async function noteInTelegram(companyId: string, text: string, options: AlertOptions): Promise<void> {
  const mode = options.telegramMode ?? currentTelegramMode();
  const chatId = mode.kind === "real" ? await telegramAlertChat(companyId) : null;
  if (mode.kind !== "real" || !chatId) {
    return;
  }
  const result = await sendTelegramMessage({ token: mode.bot.token, fetchFn: options.fetchFn ?? fetch }, { chatId, text, businessConnectionId: null });
  if (result.status !== "sent") {
    console.warn(`Owner alert on Telegram not sent: ${result.error}`);
  }
}
