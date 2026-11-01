import "server-only";
import { z } from "zod";

// Telegram (step 48): ansa's one bot, made with Telegram's @BotFather with
// Business Mode on (docs/going-live.md, section 12). The three are set
// together. Without them, development offers a stand-in Telegram account
// and production says Telegram isn't set up (lib/telegram-mode.ts). Part of
// lib/env.ts's settings, in a file of its own to keep that one short.
export const telegramSettings = {
  // BotFather's token, "<bot id>:<secret>". It is the bot: never logged,
  // never sent anywhere but api.telegram.org.
  TELEGRAM_BOT_TOKEN: z
    .string()
    .trim()
    .regex(/^[0-9]{5,20}:[A-Za-z0-9_-]{30,100}$/, "TELEGRAM_BOT_TOKEN must look like BotFather's token, 123456789:AA...")
    .optional(),
  // The bot's username without "@": the connect link opens t.me/<this>.
  TELEGRAM_BOT_USERNAME: z
    .string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9_]{3,30}[Bb][Oo][Tt]$/, "TELEGRAM_BOT_USERNAME must be the bot's username without @, ending in bot")
    .optional(),
  // Telegram sends it back in a header with every webhook (setWebhook's
  // secret_token), which is how ansa knows a request is Telegram's.
  // Generate with: openssl rand -hex 32
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{32,256}$/, "TELEGRAM_WEBHOOK_SECRET must be 32 to 256 letters, digits, _ or - (openssl rand -hex 32)")
    .optional(),
};

const TELEGRAM_SETTING_NAMES = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME", "TELEGRAM_WEBHOOK_SECRET"] as const;

type TelegramSettings = { [Name in (typeof TELEGRAM_SETTING_NAMES)[number]]?: string };

// A bot without its secret (or the other way round) would look set up and
// refuse every message.
export function requireTelegramSettingsTogether(values: TelegramSettings, context: z.RefinementCtx<TelegramSettings>): void {
  const set = TELEGRAM_SETTING_NAMES.filter((name) => values[name]);
  if (set.length === 0 || set.length === TELEGRAM_SETTING_NAMES.length) {
    return;
  }
  for (const name of TELEGRAM_SETTING_NAMES.filter((candidate) => !values[candidate])) {
    context.addIssue({ code: "custom", path: [name], message: `${TELEGRAM_SETTING_NAMES.join(", ")} must be set together` });
  }
}
