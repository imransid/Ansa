// Tells the running app, the way Resend would, that one of the emails in
// .dev-emails/ bounced, was marked as spam, or was suppressed or failed at
// Resend (never delivered). The ticket, and for the last three kinds the
// "not delivered" list on the Emails page, then show it.
//
// Run with: pnpm simulate:email-bounce <file name in .dev-emails/> [bounced|complained|suppressed|failed]
// Needs `pnpm dev` running and RESEND_WEBHOOK_SECRET set.

import { randomUUID } from "node:crypto";
import path from "node:path";
import { env } from "@/lib/env";
import { signLikeResend } from "@/lib/resend-webhook";

const KINDS = ["bounced", "complained", "suppressed", "failed"];

async function main() {
  const fileName = process.argv[2] ? path.basename(process.argv[2]) : "";
  const kind = process.argv[3] ?? "bounced";
  if (!fileName || !KINDS.includes(kind) || !env.RESEND_WEBHOOK_SECRET) {
    console.error(`Usage: pnpm simulate:email-bounce <file in .dev-emails/> [${KINDS.join("|")}] (needs RESEND_WEBHOOK_SECRET)`);
    process.exitCode = 1;
    return;
  }
  // The dev outbox records "dev-outbox:<file name>" where Resend's email id would be.
  const body = Buffer.from(JSON.stringify({ type: `email.${kind}`, created_at: new Date().toISOString(), data: { email_id: `dev-outbox:${fileName}` } }));
  const headers = signLikeResend(body, `msg_${randomUUID()}`, new Date(), env.RESEND_WEBHOOK_SECRET);
  const response = await fetch(`${env.BETTER_AUTH_URL}/api/webhooks/resend`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: new Uint8Array(body) });
  console.log(`${kind}: got ${response.status} (expected 200). Reload the ticket page.`);
}

main().catch((error) => {
  console.error("Simulation failed:", error instanceof Error ? error.constructor.name : "unknown");
  process.exitCode = 1;
});
