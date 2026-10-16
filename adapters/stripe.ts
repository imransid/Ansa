import "server-only";
import Stripe from "stripe";
import type { SubscriptionSnapshot } from "@/db/billing";
import { subscriptionStatuses, type SubscriptionStatus } from "@/db/schema";
import { env } from "@/lib/env";

// Translates our billing calls into Stripe. Only used when USE_STRIPE=true
// (lib/env.ts then requires every STRIPE_ value). Card details never touch our
// servers: customers type them on Stripe's own pages.

function stripeClient(): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY ?? "");
}

type CheckoutInput = {
  companyId: string;
  ownerEmail: string;
  // Reused when the company paid before, so Stripe keeps one customer per company.
  stripeCustomerId: string | undefined;
  successUrl: string;
  cancelUrl: string;
};

// A Stripe-hosted page where the owner subscribes to the plan (STRIPE_PRICE_ID).
export async function createCheckoutUrl(input: CheckoutInput): Promise<string> {
  const session = await stripeClient().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
    // How the webhook knows which company paid. Set by us, signed by Stripe.
    client_reference_id: input.companyId,
    subscription_data: { metadata: { companyId: input.companyId } },
    ...(input.stripeCustomerId ? { customer: input.stripeCustomerId } : { customer_email: input.ownerEmail }),
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });
  if (!session.url) {
    throw new Error("Stripe returned no checkout URL");
  }
  return session.url;
}

// Stripe's page where the owner changes card, sees invoices or cancels.
export async function createBillingPortalUrl(stripeCustomerId: string, returnUrl: string): Promise<string> {
  const session = await stripeClient().billingPortal.sessions.create({ customer: stripeCustomerId, return_url: returnUrl });
  return session.url;
}

// The parsed event if the signature is valid for these exact bytes, else null.
export function verifyStripeEvent(rawBody: Buffer, signatureHeader: string, secret: string): Stripe.Event | null {
  try {
    return Stripe.webhooks.constructEvent(rawBody, signatureHeader, secret);
  } catch {
    return null;
  }
}

// The subscription as Stripe has it now. Webhooks can arrive late or out of
// order, so we always store Stripe's current state, not the event's copy.
export async function retrieveSubscription(subscriptionId: string): Promise<SubscriptionSnapshot & { companyId: string | undefined }> {
  const subscription = await stripeClient().subscriptions.retrieve(subscriptionId);
  const customer = subscription.customer;
  // Newer Stripe API versions keep the period end on each subscription item.
  const periodEnd = subscription.items.data[0]?.current_period_end;
  return {
    stripeCustomerId: typeof customer === "string" ? customer : customer.id,
    stripeSubscriptionId: subscription.id,
    status: toOurStatus(subscription.status),
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    companyId: subscription.metadata.companyId,
  };
}

// A status Stripe adds in the future is treated as not paying.
function toOurStatus(status: string): SubscriptionStatus {
  return (subscriptionStatuses as readonly string[]).includes(status) ? (status as SubscriptionStatus) : "incomplete";
}

// Signs a body the way Stripe does. Used by the checks only.
export function signLikeStripe(rawBody: Buffer, secret: string, signedAt = new Date()): string {
  return Stripe.webhooks.generateTestHeaderString({ payload: rawBody.toString("utf8"), secret, timestamp: Math.floor(signedAt.getTime() / 1000) });
}
