import { z } from "zod";

// Only used AFTER the Stripe webhook signature has been verified. Just the
// fields we act on; everything else in the event is ignored.
export const stripeEventSchema = z.object({
  type: z.string().max(100),
  data: z.object({ object: z.unknown() }),
});

export const checkoutCompletedSchema = z.object({
  mode: z.literal("subscription"),
  // Set by us to the company id when the checkout was created.
  client_reference_id: z.uuid(),
  subscription: z.string().startsWith("sub_").max(255),
});

export const subscriptionEventSchema = z.object({
  id: z.string().startsWith("sub_").max(255),
});

export const companyIdSchema = z.uuid();

// The dev stand-in's "simulate" buttons.
export const simulatedStatusSchema = z.object({
  status: z.enum(["active", "past_due", "canceled"]),
});
