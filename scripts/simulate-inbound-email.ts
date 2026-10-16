// Sends a made-up customer email to the running app the way Resend would: it
// writes the content to .dev-inbound/<id>.json (the stand-in for Resend's
// Receiving API) and posts a signed "email.received" webhook.
//
// Run with: pnpm simulate:inbound-email support@yourcompany.com [variant]
// Variants: valid (default), unsigned, auto-reply.
// Needs `pnpm dev` running and the address linked with pnpm link:inbound-address.

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import { signLikeResend } from "@/lib/resend-webhook";

async function main() {
  const address = process.argv[2];
  const variant = process.argv[3] ?? "valid";
  if (!address || !env.RESEND_WEBHOOK_SECRET) {
    console.error("Usage: pnpm simulate:inbound-email support@yourcompany.com [valid|unsigned|auto-reply] (needs RESEND_WEBHOOK_SECRET)");
    process.exitCode = 1;
    return;
  }
  const emailId = randomUUID();
  const content = {
    from: "Sam Okafor <sam.okafor@example.com>",
    to: [address],
    subject: "Where is my order #48213?",
    text: "Hi,\n\nI ordered a monitor two weeks ago and it still hasn't arrived. Can you check?\n\nThanks,\nSam",
    headers: variant === "auto-reply" ? { "Auto-Submitted": "auto-replied" } : {},
  };
  await mkdir(path.join(process.cwd(), ".dev-inbound"), { recursive: true });
  await writeFile(path.join(process.cwd(), ".dev-inbound", `${emailId}.json`), JSON.stringify(content));

  const body = Buffer.from(JSON.stringify({ type: "email.received", created_at: new Date().toISOString(), data: { email_id: emailId, from: content.from, to: content.to, subject: content.subject } }));
  const headers = variant === "unsigned" ? {} : signLikeResend(body, `msg_${randomUUID()}`, new Date(), env.RESEND_WEBHOOK_SECRET);
  const response = await fetch(`${env.BETTER_AUTH_URL}/api/webhooks/resend`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: new Uint8Array(body) });
  console.log(`${variant}: got ${response.status} (expected ${variant === "unsigned" ? 401 : 200})`);
}

main().catch((error) => {
  console.error("Simulation failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
