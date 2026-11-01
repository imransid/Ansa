// Brings a customer's Telegram message into the Inbox through a company's
// stand-in Telegram account (step 48), so Telegram can be tried before
// ansa's bot exists: connect the stand-in on Settings → Connections first. The
// message is built as Telegram sends one and handled by the same code.
// Each run is one new message from the customer named; the same name joins
// the same conversation. The assistant then answers it (step 49) with the
// company's AI engine (Settings → Assistant). Replies are written to .dev-messages/.
// It writes to the database directly, so, like the checks, it only runs
// against a local database with every outside service off.
//
// Run with: pnpm simulate:telegram <owner email> "<customer name>" "<message>"
// The app doesn't need to be running.

import { db } from "@/db/client";
import { env } from "@/lib/env";
import type { AssistantTurn } from "@/db/assistant-runs";
import { runAssistantReply } from "@/services/assistant-reply";
import { receiveStandInTelegramMessage } from "@/services/telegram-stand-in";
import { findOwnersCompany, noOwnerMessage } from "./company-of-user";
import { findReasonNotToRunChecks } from "./tenant-isolation/local-only";

const USAGE = 'Usage: pnpm simulate:telegram <owner email> "<customer name>" "<message>"';

async function main() {
  const reasonNotToRun = findReasonNotToRunChecks(process.env);
  if (reasonNotToRun) {
    console.error(`Refusing to run (this writes a made-up customer message into the database): ${reasonNotToRun}`);
    process.exitCode = 1;
    return;
  }
  const [ownerEmail, customerName, text] = process.argv.slice(2);
  if (!ownerEmail || !customerName?.trim() || !text?.trim()) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const company = await findOwnersCompany(ownerEmail);
  if (!company) {
    console.error(noOwnerMessage(ownerEmail));
    process.exitCode = 1;
    return;
  }
  let turn: AssistantTurn | null = null;
  const outcome = await receiveStandInTelegramMessage(company.companyId, customerName.trim().slice(0, 100), text.trim().slice(0, 4000), (saved) => {
    turn = saved;
  });
  if (outcome === "no-stand-in") {
    console.error(`"${company.companyName}" has no stand-in Telegram account. Connect one on ${env.BETTER_AUTH_URL}/settings/channels first.`);
    process.exitCode = 1;
    return;
  }
  if (outcome === "not-allowed") {
    console.error("Refusing to run: stand-ins are never used in production.");
    process.exitCode = 1;
    return;
  }
  console.log(`Saved a Telegram message from "${customerName.trim()}" for "${company.companyName}".`);
  if (turn) {
    // The assistant answers as it would after Telegram's webhook (step 49).
    console.log(`The assistant: ${await runAssistantReply(turn, { settleMs: 0 })}. See it on ${env.BETTER_AUTH_URL}/inbox?view=all`);
  }
}

main()
  .catch((error) => {
    console.error(`simulate:telegram failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
