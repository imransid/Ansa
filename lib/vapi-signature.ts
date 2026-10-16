import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env, type Env } from "@/lib/env";

// How Vapi signs its webhook requests. Comes from env (see lib/env.ts) so we
// can match Vapi's real format without changing code.
export type VapiSignatureSettings = {
  secret: string;
  signatureHeader: string;
  timestampHeader: string;
  algorithm: Env["VAPI_SIGNATURE_ALGORITHM"];
  payloadFormat: Env["VAPI_SIGNATURE_PAYLOAD"];
  encoding: Env["VAPI_SIGNATURE_ENCODING"];
  prefix: string;
  timestampUnit: Env["VAPI_TIMESTAMP_UNIT"];
  toleranceSeconds: number;
};

export function getVapiSignatureSettings(): VapiSignatureSettings {
  return {
    secret: env.VAPI_WEBHOOK_SECRET,
    signatureHeader: env.VAPI_SIGNATURE_HEADER,
    timestampHeader: env.VAPI_TIMESTAMP_HEADER,
    algorithm: env.VAPI_SIGNATURE_ALGORITHM,
    payloadFormat: env.VAPI_SIGNATURE_PAYLOAD,
    encoding: env.VAPI_SIGNATURE_ENCODING,
    prefix: env.VAPI_SIGNATURE_PREFIX,
    timestampUnit: env.VAPI_TIMESTAMP_UNIT,
    toleranceSeconds: env.VAPI_TIMESTAMP_TOLERANCE_SECONDS,
  };
}

type SignatureCheck = {
  rawBody: Buffer;
  signature: string | null;
  timestamp: string | null;
  settings: VapiSignatureSettings;
  now: Date;
};

// Says whether a request really comes from Vapi: the signature must match the
// exact raw bytes received, and (when the timestamp is signed) the request
// must be recent, so a captured request cannot be replayed later.
export function isValidVapiSignature(check: SignatureCheck): boolean {
  const { rawBody, signature, timestamp, settings, now } = check;
  if (!signature || !signature.startsWith(settings.prefix)) {
    return false;
  }

  const timestampIsSigned = settings.payloadFormat === "{timestamp}.{body}";
  if (timestampIsSigned && !isRecentTimestamp(timestamp, settings, now)) {
    return false;
  }

  const expected = computeSignature(rawBody, timestamp ?? "", settings);
  const provided = signature.slice(settings.prefix.length);
  return safeEqual(expected, provided);
}

// Produces the headers Vapi would send for this body. Used by the simulator
// and the checks; the app itself only verifies.
export function signLikeVapi(
  rawBody: Buffer,
  settings: VapiSignatureSettings,
  now: Date,
): Record<string, string> {
  const timestamp = settings.timestampUnit === "seconds"
    ? String(Math.floor(now.getTime() / 1000))
    : String(now.getTime());
  const signature = settings.prefix + computeSignature(rawBody, timestamp, settings);
  return { [settings.signatureHeader]: signature, [settings.timestampHeader]: timestamp };
}

function computeSignature(rawBody: Buffer, timestamp: string, settings: VapiSignatureSettings): string {
  const signedBytes = settings.payloadFormat === "{timestamp}.{body}"
    ? Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), rawBody])
    : rawBody;
  return createHmac(settings.algorithm, settings.secret).update(signedBytes).digest(settings.encoding);
}

function isRecentTimestamp(timestamp: string | null, settings: VapiSignatureSettings, now: Date): boolean {
  // Digits only: no signs, decimals or spaces that Number() would quietly accept.
  if (!timestamp || !/^\d{1,16}$/.test(timestamp)) {
    return false;
  }
  const sentAtMs = settings.timestampUnit === "seconds" ? Number(timestamp) * 1000 : Number(timestamp);
  const ageMs = Math.abs(now.getTime() - sentAtMs);
  return ageMs <= settings.toleranceSeconds * 1000;
}

// Constant-time comparison, so response timing can't reveal how much of a
// guessed signature was right.
function safeEqual(expected: string, provided: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const providedBytes = Buffer.from(provided, "utf8");
  if (expectedBytes.length !== providedBytes.length) {
    return false;
  }
  return timingSafeEqual(expectedBytes, providedBytes);
}
