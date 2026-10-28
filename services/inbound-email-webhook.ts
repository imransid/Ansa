import "server-only";
import { markDeliveryProblem } from "@/db/email-delivery-events";
import { insertInboundEmailIfNew } from "@/db/inbound-emails";
import { readRawBodyWithLimit } from "@/lib/read-raw-body";
import { getClientIpFromHeaders } from "@/lib/request-ip";
import { isValidResendSignature } from "@/lib/resend-webhook";
import { resendEventSchema } from "@/lib/validation/resend";
import { processInboundEmail } from "./inbound-email-processing";
import { findCompanyForReceivedEmail } from "./inbound-email-routing";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";
import type { RunAfterResponse } from "./vapi-webhook";

// LOGGING RULE for this file: never log the body, addresses, subjects or error
// messages. Fixed strings and class names only (same as the Vapi webhook).

// Resend events are small (metadata only; content is fetched separately).
const MAX_BODY_BYTES = 256 * 1024;

// Resend delivery events we act on, and what they mean for the email. A
// suppressed or failed email was never delivered, although Resend accepted it
// (step 27): one company's bounce or spam report puts the address on the
// suppression list for every company, since all send from one domain.
const DELIVERY_PROBLEMS = {
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.suppressed": "suppressed",
  "email.failed": "failed",
} as const;

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

// Checks, parses and records one Resend webhook, in the order of the numbered
// steps; may throw (handleResendWebhook catches).
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
  const data = event.data.data;
  const emailId = data?.email_id;
  if (!data || !emailId) {
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

  // 4. Only a company's forwarding address decides the company (step 24).
  // Nothing else in the email is trusted for that.
  const routing = await findCompanyForReceivedEmail(data);
  if (routing.outcome === "no-forwarding-address") {
    console.warn("Inbound email ignored: no forwarding address");
    return emptyResponse(200);
  }
  if (routing.outcome === "several-companies") {
    console.warn("Inbound email ignored: forwarding addresses of more than one company");
    return emptyResponse(200);
  }
  const { companyId } = routing;
  const inboundEmailId = await insertInboundEmailIfNew(companyId, emailId);
  // 5. Fetching the content and asking Claude happen after Resend has its 200.
  if (inboundEmailId) {
    runAfterResponse(async () => {
      await processInboundEmail(companyId, inboundEmailId);
    });
  }
  return emptyResponse(200);
}

// The body as JSON, or null when it isn't JSON (never the parse error: it can quote the body).
function parseJsonOrNull(rawBody: Buffer): unknown {
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    return null;
  }
}

// An answer with only a status: Resend reads nothing else.
function emptyResponse(status: number): Response {
  return new Response(null, { status });
}
