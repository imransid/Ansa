import "server-only";
import { findCompanyForStripeCustomer, LIVE_SUBSCRIPTION_STATUSES, saveCompanySubscription } from "@/db/billing";
import { isForeignKeyViolation, isUniqueViolation } from "@/db/errors";
import { isSignedByStripe, retrieveSubscription, type RetrievedSubscription } from "@/adapters/stripe";
import { env } from "@/lib/env";
import { readRawBodyWithLimit } from "@/lib/read-raw-body";
import { getClientIpFromHeaders } from "@/lib/request-ip";
import { describeErrorWithFrames } from "@/lib/safe-error-logging";
import { checkoutCompletedSchema, companyIdSchema, stripeEventSchema, subscriptionEventSchema } from "@/lib/validation/billing";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// LOGGING RULE for this file: fixed strings, and for a failure the error's
// class, Postgres code, constraint and stack frames (describeErrorWithFrames).
// Never ids, emails, the body or an error's message.

const MAX_BODY_BYTES = 256 * 1024;

// Only the checks pass these, to avoid calling Stripe.
export type StripeWebhookOptions = {
  secret?: string;
  retrieve?: typeof retrieveSubscription;
};

// Which subscription an event is about, and, for a finished checkout, the
// company id our checkout put on it (client_reference_id).
type SubscriptionTarget = { subscriptionId: string; checkoutCompanyId?: string };

// Handles one webhook from Stripe. Never throws. Answers 500 when Stripe should
// try again later (for example Stripe's API was unreachable).
export async function handleStripeWebhook(request: Request, options: StripeWebhookOptions = {}): Promise<Response> {
  try {
    return await processStripeWebhook(request, options.secret ?? env.STRIPE_WEBHOOK_SECRET, options.retrieve ?? retrieveSubscription);
  } catch (error) {
    console.error(`Stripe webhook failed: ${describeErrorWithFrames(error)}`);
    return emptyResponse(500);
  }
}

// Checks, parses and stores one Stripe webhook; may throw (handleStripeWebhook catches).
async function processStripeWebhook(request: Request, secret: string | undefined, retrieve: typeof retrieveSubscription): Promise<Response> {
  // The same order as every webhook: 1. raw bytes only, 2. prove they came
  // from Stripe (the signed timestamp stops replays), 3. rate limit, 4. only
  // then parse and validate.
  const rawBody = await readRawBodyWithLimit(request, MAX_BODY_BYTES);
  if (rawBody === "too-large") {
    console.warn("Stripe webhook rejected: body too large");
    return emptyResponse(413);
  }
  if (!secret || !isSignedByStripe(rawBody, request.headers.get("stripe-signature") ?? "", secret)) {
    console.warn("Stripe webhook rejected: invalid signature");
    return emptyResponse(401);
  }
  if (await isOverRateLimit("stripe-webhook", getClientIpFromHeaders(request.headers), RATE_LIMITS.stripeWebhookPerIp)) {
    console.warn("Stripe webhook rejected: rate limited");
    return emptyResponse(429);
  }
  const event = stripeEventSchema.safeParse(parseJsonOrNull(rawBody));
  if (!event.success) {
    console.warn("Stripe webhook rejected: not a Stripe event");
    return emptyResponse(400);
  }

  const target = subscriptionTarget(event.data.type, event.data.data.object);
  if (!target) {
    // Every other event is acknowledged and ignored.
    return emptyResponse(200);
  }
  return saveForItsCompany(target, await retrieve(target.subscriptionId));
}

// Stores the subscription for the company it belongs to, or ignores it with a
// fixed log line. Answers 200 either way: Stripe retrying would change nothing.
async function saveForItsCompany(target: SubscriptionTarget, subscription: RetrievedSubscription): Promise<Response> {
  const customerOwner = await findCompanyForStripeCustomer(subscription.snapshot.stripeCustomerId);
  const choice = chooseCompany(target.checkoutCompanyId, subscription.metadataCompanyId, customerOwner);
  if ("ignoredBecause" in choice) {
    console.warn(`Stripe webhook ignored: ${choice.ignoredBecause}`);
    return emptyResponse(200);
  }
  try {
    // The snapshot holds no company: the company is only ever choice.companyId.
    const saved = await saveCompanySubscription(choice.companyId, subscription.snapshot);
    if (!saved && LIVE_SUBSCRIPTION_STATUSES.includes(subscription.snapshot.status)) {
      // The owner paid twice (two tabs, or a second checkout before the first
      // one's event arrived): Stripe now bills two subscriptions and only one
      // is stored. A person must cancel the other in Stripe's dashboard.
      console.error("Stripe webhook ignored: company already has another live subscription");
    }
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

// Which company a subscription is for. Our checkout puts the same company id
// in two places (adapters/stripe.ts), and both come back signed, but either can
// be edited in Stripe's dashboard, and a checkout made outside ansa (a payment
// link) may carry only client_reference_id.
// - Only a finished checkout gives a company its first billing row. A
//   subscription event about a Stripe customer no company owns yet is ignored:
//   its metadata alone could name any company. The checkout's own event stores
//   Stripe's current state, whichever of the two arrives first.
// - client_reference_id and the metadata disagree: nothing is stored. Stripe's
//   later events carry only the metadata, so a row stored for the checkout's
//   company would ignore them all.
// - No metadata (removed, or a payment link): the checkout's company, and for
//   later events the company that already owns the Stripe customer, so its
//   updates and cancellations still arrive.
// - The Stripe customer belongs to another company: ignored. Billing never moves.
function chooseCompany(
  checkoutCompanyId: string | undefined,
  metadataCompanyId: string | undefined,
  customerOwner: string | undefined,
): { companyId: string } | { ignoredBecause: string } {
  if (!checkoutCompanyId && !customerOwner) {
    return { ignoredBecause: "customer not known yet" };
  }
  if (checkoutCompanyId && metadataCompanyId && checkoutCompanyId !== metadataCompanyId) {
    return { ignoredBecause: "checkout and subscription name different companies" };
  }
  const companyId = companyIdSchema.safeParse(checkoutCompanyId ?? metadataCompanyId ?? customerOwner);
  if (!companyId.success) {
    return { ignoredBecause: "no company on the subscription" };
  }
  if (customerOwner && customerOwner !== companyId.data) {
    return { ignoredBecause: "customer belongs to another company" };
  }
  return { companyId: companyId.data };
}

// Which subscription an event is about, or null for events we don't use.
function subscriptionTarget(type: string, object: unknown): SubscriptionTarget | null {
  if (type === "checkout.session.completed") {
    const session = checkoutCompletedSchema.safeParse(object);
    return session.success ? { subscriptionId: session.data.subscription, checkoutCompanyId: session.data.client_reference_id } : null;
  }
  if (type === "customer.subscription.created" || type === "customer.subscription.updated" || type === "customer.subscription.deleted") {
    const subscription = subscriptionEventSchema.safeParse(object);
    return subscription.success ? { subscriptionId: subscription.data.id } : null;
  }
  return null;
}

// The body as JSON, or null when it isn't JSON.
function parseJsonOrNull(rawBody: Buffer): unknown {
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    return null;
  }
}

// An answer with only a status: Stripe reads nothing else.
function emptyResponse(status: number): Response {
  return new Response(null, { status });
}
