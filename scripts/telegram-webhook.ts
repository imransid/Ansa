// ansa's operator (step 48, docs/going-live.md section 12): tells Telegram
// to send ansa's bot's updates to this server's /api/webhooks/telegram,
// with TELEGRAM_WEBHOOK_SECRET, or takes the webhook off (for a development
// bot read by pnpm telegram:poll). Changes nothing in the database. Prints
// only the outcome: never the token, never Telegram's own words.
//
// Run with: pnpm telegram:webhook set     (uses BETTER_AUTH_URL, https only)
//           pnpm telegram:webhook remove

import { deleteTelegramWebhook, setTelegramWebhook } from "@/adapters/telegram";
import { env } from "@/lib/env";
import { currentTelegramMode } from "@/lib/telegram-mode";

const USAGE = "Usage: pnpm telegram:webhook set | remove";

async function main() {
  const action = process.argv[2];
  const mode = currentTelegramMode();
  if (mode.kind !== "real") {
    console.error("Set TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET first (docs/going-live.md, section 12).");
    process.exitCode = 1;
    return;
  }
  const context = { token: mode.bot.token, fetchFn: fetch };
  if (action === "remove") {
    report(await deleteTelegramWebhook(context), "Webhook removed: the bot's updates now wait for pnpm telegram:poll.");
    return;
  }
  if (action !== "set") {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const url = new URL("/api/webhooks/telegram", env.BETTER_AUTH_URL);
  if (url.protocol !== "https:") {
    console.error("Telegram sends webhooks to https addresses only: BETTER_AUTH_URL must start with https://.");
    process.exitCode = 1;
    return;
  }
  report(await setTelegramWebhook(context, url.toString(), mode.bot.webhookSecret), `Webhook set: Telegram now sends @${mode.bot.username}'s updates to ${url}.`);
}

// null: it worked; 0: Telegram didn't answer; else the HTTP status of its refusal.
function report(refusal: number | null, success: string) {
  if (refusal === null) {
    console.log(success);
    return;
  }
  console.error(refusal === 0 ? "Telegram didn't answer. Try again." : `Telegram refused (HTTP ${refusal}). Check the bot's token.`);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`telegram:webhook failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
  process.exitCode = 1;
});
