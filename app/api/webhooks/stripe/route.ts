import { handleStripeWebhook } from "@/services/stripe-webhook";

// Stripe calls this when a checkout finishes or a subscription changes.
// Everything (signature first) happens in services/stripe-webhook.ts.
export async function POST(request: Request) {
  return handleStripeWebhook(request);
}
