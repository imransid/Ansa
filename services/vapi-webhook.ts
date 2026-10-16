import "server-only";
import { readRawBodyWithLimit } from "@/lib/read-raw-body";
import { getClientIpFromHeaders } from "@/lib/request-ip";
import { getVapiSignatureSettings, isValidVapiSignature } from "@/lib/vapi-signature";
import { endOfCallReportSchema, vapiMessageTypeSchema } from "@/lib/validation/vapi";
import { analyzeCall } from "./call-analysis";
import { isCopyableRecordingUrl, storeCallRecording } from "./call-recordings";
import { saveEndOfCallReport } from "./calls";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// LOGGING RULE for this file: webhook bodies contain call transcripts, phone
// numbers and recording URLs. Never log the body, any part of it, a parse
// error, or an error message (database errors include query values). Only
// the fixed strings below and an error's class name may be logged.

const MAX_BODY_BYTES = 1024 * 1024;

// Runs work after the response has been sent. The route passes Next.js's
// after(); the checks pass a function that records the work instead.
export type RunAfterResponse = (task: () => Promise<void>) => void;

// Handles one request from Vapi. Never throws.
export async function handleVapiWebhook(request: Request, runAfterResponse: RunAfterResponse): Promise<Response> {
  try {
    return await processVapiWebhook(request, runAfterResponse);
  } catch (error) {
    const errorName = error instanceof Error ? error.constructor.name : "unknown";
    console.error(`Vapi webhook failed: ${errorName}`);
    return emptyResponse(500);
  }
}

async function processVapiWebhook(request: Request, runAfterResponse: RunAfterResponse): Promise<Response> {
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
  const saved = await saveEndOfCallReport(report.data);
  if (saved.outcome === "unknown-phone-line") {
    console.warn("Vapi webhook ignored: unknown phone line");
  }

  // 5. A new call gets analyzed by the call brain after Vapi has its 200, so
  // Vapi never waits for Claude. A duplicate delivery is not analyzed again.
  if (saved.outcome === "saved") {
    const { companyId, callId, recordingUrl } = saved;
    runAfterResponse(async () => {
      await analyzeCall(companyId, callId);
    });
    // 6. Copy the recording into private storage, but only from an allowed
    // host (lib/recording-download.ts explains why). The URL is never logged.
    if (recordingUrl && isCopyableRecordingUrl(recordingUrl)) {
      runAfterResponse(async () => {
        await storeCallRecording(companyId, callId, recordingUrl);
      });
    } else if (recordingUrl) {
      console.warn("Vapi recording ignored: host not allowed");
    }
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
