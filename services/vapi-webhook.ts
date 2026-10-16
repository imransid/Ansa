import "server-only";
import { readRawBodyWithLimit } from "@/lib/read-raw-body";
import { getClientIpFromHeaders } from "@/lib/request-ip";
import { getVapiSignatureSettings, isValidVapiSignature } from "@/lib/vapi-signature";
import { endOfCallReportSchema, vapiMessageTypeSchema } from "@/lib/validation/vapi";
import { saveEndOfCallReport } from "./calls";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// LOGGING RULE for this file: webhook bodies contain call transcripts, phone
// numbers and recording URLs. Never log the body, any part of it, a parse
// error, or an error message (database errors include query values). Only
// the fixed strings below and an error's class name may be logged.

const MAX_BODY_BYTES = 1024 * 1024;

// Handles one request from Vapi. Never throws.
export async function handleVapiWebhook(request: Request): Promise<Response> {
  try {
    return await processVapiWebhook(request);
  } catch (error) {
    const errorName = error instanceof Error ? error.constructor.name : "unknown";
    console.error(`Vapi webhook failed: ${errorName}`);
    return emptyResponse(500);
  }
}

async function processVapiWebhook(request: Request): Promise<Response> {
  // 1. Raw bytes only, nothing decoded or parsed yet.
  const rawBody = await readRawBodyWithLimit(request, MAX_BODY_BYTES);
  if (rawBody === "too-large") {
    console.warn("Vapi webhook rejected: body too large");
    return emptyResponse(413);
  }

  // 2. Prove the bytes came from Vapi before looking at them.
  const settings = getVapiSignatureSettings();
  const signatureIsValid = isValidVapiSignature({
    rawBody,
    signature: request.headers.get(settings.signatureHeader),
    timestamp: request.headers.get(settings.timestampHeader),
    settings,
    now: new Date(),
  });
  if (!signatureIsValid) {
    console.warn("Vapi webhook rejected: invalid signature");
    return emptyResponse(401);
  }

  // From here on the request is from Vapi. The limit only protects the
  // database if the secret ever leaks.
  const ip = getClientIpFromHeaders(request.headers);
  if (await isOverRateLimit("vapi-webhook", ip, RATE_LIMITS.vapiWebhookPerIp)) {
    console.warn("Vapi webhook rejected: rate limited");
    return emptyResponse(429);
  }

  // 3. Only now parse and validate.
  const payload = parseJsonOrNull(rawBody);
  const messageType = vapiMessageTypeSchema.safeParse(payload);
  if (!messageType.success) {
    console.warn("Vapi webhook rejected: not a Vapi message");
    return emptyResponse(400);
  }
  // Other events (status updates, live transcript pieces, ...) are not used yet.
  if (messageType.data.message.type !== "end-of-call-report") {
    return emptyResponse(200);
  }

  const report = endOfCallReportSchema.safeParse(payload);
  if (!report.success) {
    console.warn("Vapi webhook rejected: invalid end-of-call-report");
    return emptyResponse(400);
  }

  // 4. Save it. A phone line we don't know is acknowledged (so Vapi stops
  // retrying) but nothing is stored.
  const outcome = await saveEndOfCallReport(report.data);
  if (outcome === "unknown-phone-line") {
    console.warn("Vapi webhook ignored: unknown phone line");
  }
  return emptyResponse(200);
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
