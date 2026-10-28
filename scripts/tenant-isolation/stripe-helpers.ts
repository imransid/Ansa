// Shared by the billing checks: builds Stripe events, signs them like Stripe
// and posts them straight into the webhook handler with a FAKE Stripe API
// (no network calls).

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { signLikeStripe, type RetrievedSubscription } from "@/adapters/stripe";
import type { SubscriptionSnapshot } from "@/db/billing";
import { handleStripeWebhook } from "@/services/stripe-webhook";
import { captureConsole } from "./helpers";

const secret = `whsec_test_${randomUUID()}`;

// An event body as Stripe sends it.
export function stripeEvent(type: string, object: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify({ id: `evt_${randomUUID()}`, object: "event", type, data: { object } }));
}

// The Stripe-Signature header for a body, made with the checks' secret.
export function signedLikeStripe(body: Buffer, at?: Date): string {
  return signLikeStripe(body, secret, at);
}

// What the fake Stripe API returns for a subscription.
export function fakeSubscription(snapshot: SubscriptionSnapshot, metadataCompanyId: string | undefined): RetrievedSubscription {
  return { snapshot, metadataCompanyId };
}

// Posts a body to the webhook handler. Returns the status, every line logged
// meanwhile, and which subscriptions the handler asked the fake Stripe for.
export async function postToStripeWebhook(
  body: Buffer,
  signature: string | null,
  subscription?: RetrievedSubscription,
  headers: Record<string, string> = {},
) {
  const asked: string[] = [];
  const allHeaders: Record<string, string> = signature ? { ...headers, "stripe-signature": signature } : headers;
  const request = new Request("http://localhost/api/webhooks/stripe", { method: "POST", headers: allHeaders, body: new Uint8Array(body) });
  const retrieve = async (id: string) => {
    asked.push(id);
    assert.ok(subscription, "Stripe was asked for a subscription");
    return subscription;
  };
  const { result, logs } = await captureConsole(async () => (await handleStripeWebhook(request, { secret, retrieve })).status);
  return { status: result, logs, asked };
}
