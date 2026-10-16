import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { escapeHtml } from "@/lib/escape-html";
import type { EmailMessage, EmailSendResult } from "@/lib/send-email";

// Not a real vendor: the stand-in for Resend whenever SEND_REAL_EMAIL is not
// "true". Each email becomes an HTML file in .dev-emails/ (git-ignored) that
// you can open in a browser. Nothing is sent anywhere.
const OUTBOX_DIR = path.join(process.cwd(), ".dev-emails");

export async function writeToDevOutbox(message: EmailMessage): Promise<EmailSendResult> {
  const fileName = `${new Date().toISOString().replaceAll(":", "-")}-${message.idempotencyKey}.html`;
  const header = [
    ["From", message.from],
    ["To", message.to],
    ["Reply-To", message.replyTo ?? "(none)"],
    ["Subject", message.subject],
  ]
    .map(([label, value]) => `<div><strong>${label}:</strong> ${escapeHtml(value)}</div>`)
    .join("\n");

  const page = `<!doctype html>
<html>
  <body>
    <p style="background: #fff3cd; padding: 8px;">Dev outbox: this email was NOT sent.</p>
    ${header}
    <hr />
    ${message.html}
    <hr />
    <pre>${escapeHtml(message.text)}</pre>
  </body>
</html>`;

  try {
    await mkdir(OUTBOX_DIR, { recursive: true });
    await writeFile(path.join(OUTBOX_DIR, fileName), page, "utf8");
  } catch (error) {
    // For example a read-only disk in production with real email still off.
    return { ok: false, error: `Could not write dev outbox file: ${error instanceof Error ? error.message : "unknown"}` };
  }

  // Only the file name is logged, never the recipient or the content.
  console.log(`[dev email] Not sent. Saved to .dev-emails/${fileName}`);
  return { ok: true, providerMessageId: `dev-outbox:${fileName}` };
}
