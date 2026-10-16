import "server-only";
import { Webhook } from "standardwebhooks";
import { env } from "@/lib/env";

// Resend signs its webhooks with the "Standard Webhooks" scheme (an HMAC over
// "<id>.<timestamp>.<raw body>", refused if older than 5 minutes). Resend sends
// the headers as svix-*; the standard names are webhook-*. Accept either.

function headerValue(headers: Headers, name: string): string {
  return headers.get(`svix-${name}`) ?? headers.get(`webhook-${name}`) ?? "";
}

// Says whether a request really comes from Resend. Checks the raw bytes; the
// body is not parsed here.
export function isValidResendSignature(rawBody: Buffer, headers: Headers, secret = env.RESEND_WEBHOOK_SECRET): boolean {
  if (!secret) {
    return false;
  }
  try {
    new Webhook(secret).verify(
      rawBody.toString("utf8"),
      {
        "webhook-id": headerValue(headers, "id"),
        "webhook-timestamp": headerValue(headers, "timestamp"),
        "webhook-signature": headerValue(headers, "signature"),
      },
      { jsonParse: false },
    );
    return true;
  } catch {
    return false;
  }
}

// Produces the headers Resend would send for this body. Used by the simulator
// and the checks; the app itself only verifies.
export function signLikeResend(rawBody: Buffer, messageId: string, sentAt: Date, secret: string): Record<string, string> {
  const signature = new Webhook(secret).sign(messageId, sentAt, rawBody.toString("utf8"));
  return { "svix-id": messageId, "svix-timestamp": String(Math.floor(sentAt.getTime() / 1000)), "svix-signature": signature };
}
