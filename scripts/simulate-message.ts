// Brings a customer's chat message into the Inbox through the development
// stand-in channel (step 47), so the Inbox can be tried without Telegram or
// Messenger. Each run is one new message from the customer named; the same
// name joins the same conversation, and the assistant answers it (step 49).
// Replies to a stand-in customer are written to .dev-messages/.
// It writes to the database directly, so, like the checks, it only runs
// against a local database with every outside service off.
//
// Run with: pnpm simulate:message <owner email> "<customer name>" "<message>"
// The app doesn't need to be running.

import { db } from "@/db/client";
import { env } from "@/lib/env";
import { runAssistantReply } from "@/services/assistant-reply";
import { receiveStandInMessage } from "@/services/conversations";
import { findOwnersCompany, noOwnerMessage } from "./company-of-user";
import { findReasonNotToRunChecks } from "./tenant-isolation/local-only";

const USAGE = 'Usage: pnpm simulate:message <owner email> "<customer name>" "<message>"';

async function main() {
  const reasonNotToRun = findReasonNotToRunChecks(process.env);
  if (reasonNotToRun) {
    console.error(`Refusing to run (this writes a made-up customer message into the database): ${reasonNotToRun}`);
    process.exitCode = 1;
    return;
  }
  const [ownerEmail, customerName, text] = process.argv.slice(2);
  if (!ownerEmail || !customerName || !text?.trim()) {
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
  const turn = await receiveStandInMessage(company.companyId, customerName, text.trim().slice(0, 4000));
  console.log(`Saved a message from "${customerName}" for "${company.companyName}".`);
  if (turn) {
    // The assistant answers as it would a real chat (step 49).
    console.log(`The assistant: ${await runAssistantReply(turn, { settleMs: 0 })}. See it on ${env.BETTER_AUTH_URL}/inbox?view=all`);
  }
}

main()
  .catch((error) => {
    console.error(`simulate:message failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
