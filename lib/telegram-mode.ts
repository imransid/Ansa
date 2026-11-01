import "server-only";
import { env, type Env } from "@/lib/env";

// Whether this server can connect Telegram (step 48), the "real / stand-in
// / not set up" pattern of the social accounts (lib/social-mode.ts):
// "real": ansa's bot is set (the three settings of lib/telegram-settings.ts).
// "stand-in": development without the bot: Settings → Connections offers a
//   stand-in Telegram account, `pnpm simulate:telegram` brings its
//   customers' messages in, and replies are written to .dev-messages/.
// "not-set-up": production without the bot: the page says ansa hasn't set
//   Telegram up yet. The stand-in is never used there.

export type TelegramBot = { token: string; username: string; webhookSecret: string };

export type TelegramMode = { kind: "real"; bot: TelegramBot } | { kind: "stand-in" } | { kind: "not-set-up" };

export type TelegramModeSettings = Pick<Env, "TELEGRAM_BOT_TOKEN" | "TELEGRAM_BOT_USERNAME" | "TELEGRAM_WEBHOOK_SECRET">;

// Which mode, from the settings and the NODE_ENV the server runs with. Takes
// both as arguments so the checks can try production without running in it.
export function telegramModeFor(settings: TelegramModeSettings, nodeEnv: string | undefined): TelegramMode {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_BOT_USERNAME: username, TELEGRAM_WEBHOOK_SECRET: webhookSecret } = settings;
  if (token && username && webhookSecret) {
    return { kind: "real", bot: { token, username, webhookSecret } };
  }
  return nodeEnv === "production" ? { kind: "not-set-up" } : { kind: "stand-in" };
}

// The mode for this server's own settings.
export function currentTelegramMode(): TelegramMode {
  return telegramModeFor(env, process.env.NODE_ENV);
}

// Whether a stand-in Telegram account may be connected or sent through.
// Never in production, whatever is set.
export function telegramStandInsAllowed(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv !== "production";
}
