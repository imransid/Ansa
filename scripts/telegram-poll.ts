// Development only (step 48): reads ansa's bot's updates from Telegram with
// the bot's token (getUpdates) and handles each with the same code as the
// webhook, so a real Telegram account can be tried on this laptop without a
// public address or a tunnel. Telegram refuses it while the bot has a
// webhook: use a bot of its own for development (pnpm telegram:webhook
// remove takes a webhook off). Ctrl+C stops it. Needs the three TELEGRAM_
// settings in .env.local and a local database; never runs in production.
//
// Run with: pnpm telegram:poll

import { getTelegramUpdates, sendTelegramMessage } from "@/adapters/telegram";
import { db } from "@/db/client";
import { currentTelegramMode } from "@/lib/telegram-mode";
import { telegramUpdateSchema } from "@/lib/validation/telegram";
import { runDueAssistantReplies } from "@/services/assistant-due";
import { runAssistantReply } from "@/services/assistant-reply";
import { handleTelegramUpdate, type AnswerCustomer } from "@/services/telegram-updates";
import { isLocalDatabase } from "./tenant-isolation/local-only";

// After a failed read, wait this long before asking again.
const RETRY_AFTER_MS = 5_000;

async function main() {
  const mode = currentTelegramMode();
  if (process.env.NODE_ENV === "production" || !isLocalDatabase(process.env)) {
    console.error("Refusing to run: telegram:poll is for development, against a local database.");
    process.exitCode = 1;
    return;
  }
  if (mode.kind !== "real") {
    console.error("Set TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET in .env.local first (docs/going-live.md, section 12).");
    process.exitCode = 1;
    return;
  }
  const context = { token: mode.bot.token, fetchFn: fetch };
  const notify = (chatId: string, text: string) => {
    void sendTelegramMessage(context, { chatId, text, businessConnectionId: null }).then((result) => {
      if (result.status !== "sent") {
        console.warn(`Note to the owner not sent: ${result.error}`);
      }
    });
  };
  // The assistant answers each customer message (step 49), as after the webhook.
  const answer: AnswerCustomer = (turn) => {
    void runAssistantReply(turn).then((outcome) => console.log(`The assistant: ${outcome}.`));
  };
  console.log(`Reading @${mode.bot.username}'s messages. Press Ctrl+C to stop.`);
  let offset = 0;
  while (true) {
    // Messages you didn't answer in time (step 51), as the scheduled job would.
    const caughtUp = await runDueAssistantReplies();
    if (caughtUp.answered > 0) {
      console.log(`The assistant stepped in for ${caughtUp.answered} unanswered ${caughtUp.answered === 1 ? "message" : "messages"}.`);
    }
    const result = await getTelegramUpdates(context, offset);
    if (result.kind === "webhook_set") {
      console.error("This bot has a webhook, so Telegram sends its messages there. Remove it with: pnpm telegram:webhook remove");
      process.exitCode = 1;
      return;
    }
    if (result.kind === "failed") {
      console.warn(`Telegram didn't answer (${result.status ?? "no answer"}). Trying again in 5 seconds.`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
      continue;
    }
    for (const raw of result.updates) {
      const update = telegramUpdateSchema.safeParse(raw);
      const updateId = (raw as { update_id?: unknown })?.update_id;
      if (typeof updateId === "number") {
        offset = Math.max(offset, updateId + 1);
      }
      if (update.success) {
        await handleTelegramUpdate(update.data, notify, answer);
        console.log(`Handled an update (${describeKind(update.data)}).`);
      }
    }
  }
}

// What kind of update it was, never what it held.
function describeKind(update: { message?: unknown; business_connection?: unknown; business_message?: unknown; deleted_business_messages?: unknown }): string {
  if (update.message) {
    return "a message to the bot";
  }
  if (update.business_connection) {
    return "a business connection";
  }
  if (update.business_message) {
    return "a customer chat message";
  }
  return update.deleted_business_messages ? "deleted messages" : "ignored";
}

main()
  .catch((error) => {
    console.error(`telegram:poll failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
