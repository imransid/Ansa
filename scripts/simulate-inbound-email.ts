// Sends a made-up customer email to the running app the way Resend would: it
// writes the content to .dev-inbound/<id>.json (the stand-in for Resend's
// Receiving API) and posts a signed "email.received" webhook addressed to a
// company's forwarding address. The app reads the stand-in only while
// SEND_REAL_EMAIL is not "true" (lib/inbound-email.ts); with real email on it
// asks Resend for this made-up id, and the email is ignored ("content_unavailable").
//
// Run with: pnpm simulate:inbound-email owner@theircompany.com [variant]
//       or: pnpm simulate:inbound-email c-<token>@inbound.ansa.test [variant]
// The first form looks up the forwarding address of that owner's company
// (a confirmed owner who was not removed: scripts/company-of-user.ts).
// Variants:
//   valid (default)  the forwarding address in `to`, sender passed DKIM and
//                    DMARC: a ticket whose customer email is the sender
//   unauthenticated  sender failed SPF, DKIM and DMARC (a forged From): a
//                    ticket with no customer email, sender shown "not verified"
//   cc               the forwarding address only in `cc`: becomes a ticket too
//   typed-only       only a typed address like support@yourcompany.example:
//                    answered 200 but ignored (typed addresses never decide)
//   auto-reply       an automatic reply: no ticket (listed on the Emails page)
//   newsletter       has a List-Unsubscribe header: no ticket ("bulk mail")
//   html-only        no plain-text part, two attachments and a signature logo:
//                    the ticket shows text taken from the HTML, "2 attachments
//                    not shown" and "1 image inside the email not shown"
//   contact-form     sent by a website form's relay with the customer in
//                    Reply-To: no customer email, the Reply-To is suggested
//   odd-sender       a quoted display name with quotes inside and an
//                    international domain: still a ticket, name and address read
//   thread-reply     an Outlook reply with a "-- " signature above an earlier
//                    message that names other people: with ANTHROPIC_API_KEY
//                    set, the AI summary is only about the refund question
//                    (step 28); the ticket's "Original email" shows it all
//   unsigned         no signature: refused with 401
// Like Resend, `from` is the bare address and the display name is only in
// headers.from. Needs `pnpm dev` running.

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/db/client";
import { getInboundTokenForCompany } from "@/db/inbound-emails";
import { env } from "@/lib/env";
import { buildForwardingAddress, readForwardingToken } from "@/lib/forwarding-address";
import { signLikeResend } from "@/lib/resend-webhook";
import { findOwnersCompany } from "./company-of-user";

const VARIANTS = ["valid", "unauthenticated", "cc", "typed-only", "auto-reply", "newsletter", "html-only", "contact-form", "odd-sender", "thread-reply", "unsigned"];
// Resend's own SPF/DKIM/DMARC results, as its receiving API returns them.
const PASSED_CHECKS = { spf: "pass", dkim: "pass", dmarc: "pass" };
const FAILED_CHECKS = { spf: "fail", dkim: "fail", dmarc: "fail" };
const TYPED_ADDRESS = "support@yourcompany.example";

// The forwarding address given, or the one of the given owner's company.
async function findForwardingAddress(addressOrOwnerEmail: string): Promise<string | undefined> {
  if (readForwardingToken(addressOrOwnerEmail)) {
    return addressOrOwnerEmail;
  }
  const company = await findOwnersCompany(addressOrOwnerEmail);
  const token = company ? await getInboundTokenForCompany(company.companyId) : undefined;
  return token ? buildForwardingAddress(token) : undefined;
}

// Who the webhook says the email was for, per variant.
function recipientsFor(variant: string, forwardingAddress: string) {
  if (variant === "cc") {
    return { to: [TYPED_ADDRESS], cc: [forwardingAddress] };
  }
  if (variant === "typed-only") {
    return { to: [TYPED_ADDRESS], cc: [] };
  }
  return { to: [forwardingAddress], cc: [] };
}

// What the email holds, per variant, in the shape of Resend's receiving API.
function contentFor(variant: string, to: string[]) {
  const content = {
    from: "sam.okafor@example.com",
    to,
    reply_to: [] as string[],
    subject: "Where is my order #48213?",
    text: "Hi,\n\nI ordered a monitor two weeks ago and it still hasn't arrived. Can you check?\n\nThanks,\nSam" as string | null,
    html: null as string | null,
    attachments: [] as { filename: string; content_id?: string }[],
    headers: { from: "Sam Okafor <sam.okafor@example.com>" } as Record<string, string>,
    authentication: variant === "unauthenticated" ? FAILED_CHECKS : PASSED_CHECKS,
  };
  if (variant === "auto-reply") {
    content.headers["Auto-Submitted"] = "auto-replied";
  }
  if (variant === "newsletter") {
    content.headers["List-Unsubscribe"] = "<https://news.example.com/unsubscribe>";
  }
  if (variant === "html-only") {
    content.text = null;
    content.html =
      '<html><head><style>p{color:red}</style></head><body><p>Hi,</p><p>The monitor arrived <b>broken</b>. Photos attached.</p><p>Sam</p><img src="cid:logo@sam.example"></body></html>';
    content.attachments = [{ filename: "front.jpg" }, { filename: "box.jpg" }, { filename: "logo.png", content_id: "<logo@sam.example>" }];
  }
  if (variant === "contact-form") {
    content.from = "noreply@forms.example.com";
    content.headers.from = "Website form <noreply@forms.example.com>";
    content.reply_to = ["Ana Lima <ana.lima@example.com>"];
  }
  if (variant === "odd-sender") {
    content.from = "ivan@почта.рф";
    content.headers.from = '"Ivan \\"The Customer\\" Petrov" <ivan@почта.рф>';
  }
  if (variant === "thread-reply") {
    content.subject = "RE: Your order #48213";
    content.text = [
      "Hi, I sent the monitor back last week. When do I get my refund?",
      "",
      "-- ",
      "Sam Okafor | Head of Purchasing, Example Ltd | +1 555 0100",
      "",
      "From: Jane Doe <jane.doe@shop.example>",
      "Sent: Monday, October 12, 2026 10:00 AM",
      "To: Sam Okafor <sam.okafor@example.com>; Bob Roe <bob.roe@other.example>",
      "Subject: Your order #48213",
      "",
      "Hello Sam, Bob Roe from our warehouse will collect the keyboard on Friday.",
    ].join("\r\n");
  }
  return content;
}

async function main() {
  const variant = process.argv[3] ?? "valid";
  const forwardingAddress = await findForwardingAddress(process.argv[2] ?? "");
  if (!forwardingAddress || !VARIANTS.includes(variant) || !env.RESEND_WEBHOOK_SECRET) {
    console.error(`Usage: pnpm simulate:inbound-email <owner email or forwarding address> [${VARIANTS.join("|")}] (needs RESEND_WEBHOOK_SECRET and a confirmed owner)`);
    process.exitCode = 1;
    return;
  }
  const emailId = randomUUID();
  const recipients = recipientsFor(variant, forwardingAddress);
  const content = contentFor(variant, recipients.to);
  await mkdir(path.join(process.cwd(), ".dev-inbound"), { recursive: true });
  await writeFile(path.join(process.cwd(), ".dev-inbound", `${emailId}.json`), JSON.stringify(content));

  const event = { type: "email.received", created_at: new Date().toISOString(), data: { email_id: emailId, from: content.from, ...recipients, bcc: [], received_for: [], subject: content.subject } };
  const body = Buffer.from(JSON.stringify(event));
  const headers = variant === "unsigned" ? {} : signLikeResend(body, `msg_${randomUUID()}`, new Date(), env.RESEND_WEBHOOK_SECRET);
  const response = await fetch(`${env.BETTER_AUTH_URL}/api/webhooks/resend`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: new Uint8Array(body) });
  console.log(`${variant}: got ${response.status} (expected ${variant === "unsigned" ? 401 : 200}). Sent to ${forwardingAddress}.`);
}

main()
  .catch((error) => {
    console.error("Simulation failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
