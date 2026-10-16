import "server-only";
import { markDeliveryProblem } from "@/db/email-delivery-events";
import { findCompanyForInboundAddress, insertInboundEmailIfNew } from "@/db/inbound-emails";
import { readRawBodyWithLimit } from "@/lib/read-raw-body";
import { getClientIpFromHeaders } from "@/lib/request-ip";
import { isValidResendSignature } from "@/lib/resend-webhook";
import { parseMailbox, resendEventSchema } from "@/lib/validation/resend";
import { processInboundEmail } from "./inbound-email-processing";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";
import type { RunAfterResponse } from "./vapi-webhook";

// LOGGING RULE for this file: never log the body, addresses, subjects or error
// messages. Fixed strings and class names only (same as the Vapi webhook).

// Resend events are small (metadata only; content is fetched separately).
const MAX_BODY_BYTES = 256 * 1024;

// Resend delivery events we act on, and what they mean for the email.
const DELIVERY_PROBLEMS = { "email.bounced": "bounced", "email.complained": "complained" } as const;

// Handles one webhook from Resend: received emails (step 15) and delivery
// problems of emails we sent (step 17). Never throws.
export async function handleResendWebhook(request: Request, runAfterResponse: RunAfterResponse): Promise<Response> {
  try {
    return await processResendWebhook(request, runAfterResponse);
  } catch (error) {
    console.error(`Resend webhook failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
    return emptyResponse(500);
  }
}

async function processResendWebhook(request: Request, runAfterResponse: RunAfterResponse): Promise<Response> {
  // 1. Raw bytes only, nothing parsed yet. 2. Prove they came from Resend.
  const rawBody = await readRawBodyWithLimit(request, MAX_BODY_BYTES);
  if (rawBody === "too-large") {
    console.warn("Resend webhook rejected: body too large");
    return emptyResponse(413);
  }
  if (!isValidResendSignature(rawBody, request.headers)) {
    console.warn("Resend webhook rejected: invalid signature");
    return emptyResponse(401);
  }
  if (await isOverRateLimit("resend-webhook", getClientIpFromHeaders(request.headers), RATE_LIMITS.resendWebhookPerIp)) {
    console.warn("Resend webhook rejected: rate limited");
    return emptyResponse(429);
  }

  // 3. Only now parse.
  const event = resendEventSchema.safeParse(parseJsonOrNull(rawBody));
  if (!event.success) {
    console.warn("Resend webhook rejected: not a Resend event");
    return emptyResponse(400);
  }
  const emailId = event.data.data?.email_id;
  if (!emailId) {
    return emptyResponse(200);
  }
  if (Object.hasOwn(DELIVERY_PROBLEMS, event.data.type)) {
    await markDeliveryProblem(emailId, DELIVERY_PROBLEMS[event.data.type as keyof typeof DELIVERY_PROBLEMS]);
    return emptyResponse(200);
  }
  // Every other event (delivered, opened...) is acknowledged and ignored.
  if (event.data.type !== "email.received") {
    return emptyResponse(200);
  }

  // 4. The address it was sent to decides the company. Nothing else in the email is trusted for that.
  const companyId = await findCompanyForRecipients(event.data.data?.to ?? []);
  if (!companyId) {
    console.warn("Inbound email ignored: unknown address");
    return emptyResponse(200);
  }
  const inboundEmailId = await insertInboundEmailIfNew(companyId, emailId);
  // 5. Fetching the content and asking Claude happen after Resend has its 200.
  if (inboundEmailId) {
    runAfterResponse(async () => {
      await processInboundEmail(companyId, inboundEmailId);
    });
  }
  return emptyResponse(200);
}

async function findCompanyForRecipients(recipients: string[]): Promise<string | undefined> {
  for (const recipient of recipients) {
    const companyId = await findCompanyForInboundAddress(parseMailbox(recipient).address);
    if (companyId) {
      return companyId;
    }
  }
  return undefined;
}

function parseJsonOrNull(rawBody: Buffer): unknown {
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    return null;
  }
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}
