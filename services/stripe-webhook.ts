import "server-only";
import { findCompanyForStripeCustomer, saveCompanySubscription } from "@/db/billing";
import { isForeignKeyViolation, isUniqueViolation } from "@/db/errors";
import { retrieveSubscription, verifyStripeEvent } from "@/adapters/stripe";
import { env } from "@/lib/env";
import { readRawBodyWithLimit } from "@/lib/read-raw-body";
import { getClientIpFromHeaders } from "@/lib/request-ip";
import { checkoutCompletedSchema, companyIdSchema, subscriptionEventSchema } from "@/lib/validation/billing";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// LOGGING RULE for this file: fixed strings and class names only. Never ids,
// emails or the body.

const MAX_BODY_BYTES = 256 * 1024;

// Only the checks pass these, to avoid calling Stripe.
export type StripeWebhookOptions = {
  secret?: string;
  retrieve?: typeof retrieveSubscription;
};

// Handles one webhook from Stripe. Never throws. Answers 500 when Stripe should
// try again later (for example Stripe's API was unreachable).
export async function handleStripeWebhook(request: Request, options: StripeWebhookOptions = {}): Promise<Response> {
  try {
    return await processStripeWebhook(request, options.secret ?? env.STRIPE_WEBHOOK_SECRET, options.retrieve ?? retrieveSubscription);
  } catch (error) {
    console.error(`Stripe webhook failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
    return emptyResponse(500);
  }
}

async function processStripeWebhook(request: Request, secret: string | undefined, retrieve: typeof retrieveSubscription): Promise<Response> {
  // 1. Raw bytes only. 2. Prove they came from Stripe (the SDK also checks the
  // signed timestamp, which stops replays). Only then is anything parsed.
  const rawBody = await readRawBodyWithLimit(request, MAX_BODY_BYTES);
  if (rawBody === "too-large") {
    console.warn("Stripe webhook rejected: body too large");
    return emptyResponse(413);
  }
  const event = secret ? verifyStripeEvent(rawBody, request.headers.get("stripe-signature") ?? "", secret) : null;
  if (!event) {
    console.warn("Stripe webhook rejected: invalid signature");
    return emptyResponse(401);
  }
  if (await isOverRateLimit("stripe-webhook", getClientIpFromHeaders(request.headers), RATE_LIMITS.stripeWebhookPerIp)) {
    return emptyResponse(429);
  }

  const target = subscriptionTarget(event.type, event.data.object);
  if (!target) {
    // Every other event is acknowledged and ignored.
    return emptyResponse(200);
  }
  const subscription = await retrieve(target.subscriptionId);
  // The company id was put on the checkout and the subscription by us
  // (adapters/stripe.ts) and comes back signed.
  const companyId = companyIdSchema.safeParse(target.companyId ?? subscription.companyId);
  if (!companyId.success) {
    console.warn("Stripe webhook ignored: no company on the subscription");
    return emptyResponse(200);
  }
  const owner = await findCompanyForStripeCustomer(subscription.stripeCustomerId);
  if (owner && owner !== companyId.data) {
    console.warn("Stripe webhook ignored: customer belongs to another company");
    return emptyResponse(200);
  }
  try {
    await saveCompanySubscription(companyId.data, subscription);
  } catch (error) {
    // Unknown company, or a Stripe customer/subscription already stored for
    // another company: never move billing between companies.
    if (isForeignKeyViolation(error) || isUniqueViolation(error)) {
      console.warn("Stripe webhook ignored: company mismatch");
      return emptyResponse(200);
    }
    throw error;
  }
  return emptyResponse(200);
}

// Which subscription an event is about, or null for events we don't use.
function subscriptionTarget(type: string, object: unknown): { subscriptionId: string; companyId?: string } | null {
  if (type === "checkout.session.completed") {
    const session = checkoutCompletedSchema.safeParse(object);
    return session.success ? { subscriptionId: session.data.subscription, companyId: session.data.client_reference_id } : null;
  }
  if (type === "customer.subscription.created" || type === "customer.subscription.updated" || type === "customer.subscription.deleted") {
    const subscription = subscriptionEventSchema.safeParse(object);
    return subscription.success ? { subscriptionId: subscription.data.id } : null;
  }
  return null;
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}
