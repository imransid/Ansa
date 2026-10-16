import { boolean, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";

// Stripe's subscription statuses, as Stripe names them.
export const subscriptionStatuses = [
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "paused",
  "incomplete",
  "incomplete_expired",
  "canceled",
] as const;
export const subscriptionStatusEnum = pgEnum("subscription_status", subscriptionStatuses);
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];

// One row per company that has started paying (no row = never subscribed).
// Written only from Stripe's signed webhooks (or the dev stand-in), never from
// what a browser sends.
export const companyBilling = pgTable("company_billing", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "restrict" }),
  stripeCustomerId: text("stripe_customer_id").notNull().unique(),
  stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
  status: subscriptionStatusEnum("status").notNull(),
  // When the paid period ends (renews, or stops if cancelAtPeriodEnd).
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
