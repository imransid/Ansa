import { sql } from "drizzle-orm";
import { boolean, check, date, integer, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
export const companyBilling = pgTable(
  "company_billing",
  {
    companyId: uuid("company_id")
      .primaryKey()
      .references(() => companies.id, { onDelete: "restrict" }),
    stripeCustomerId: text("stripe_customer_id").notNull().unique(),
    stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
    status: subscriptionStatusEnum("status").notNull(),
    // The package the subscription's price is (step 57, core/internal/packages;
    // subscriptions from before it were the one plan, now Business).
    package: text("package").notNull().default("business"),
    // When the paid period ends (renews, or stops if cancelAtPeriodEnd).
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [check("company_billing_package_known", sql`${table.package} IN ('personal', 'business', 'pro')`)],
);

// What a company used in one calendar month (step 57), counted by core
// against its package's limits (core/internal/packages): replies written
// with ansa's AI and seconds of calls answered live. month = the first day
// of the month (UTC).
export const usageMonths = pgTable(
  "usage_months",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    month: date("month", { mode: "string" }).notNull(),
    aiReplies: integer("ai_replies").notNull().default(0),
    callSeconds: integer("call_seconds").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "usage_months_pkey", columns: [table.companyId, table.month] }),
    check("usage_months_first_day", sql`extract(day from ${table.month}) = 1`),
    check("usage_months_not_negative", sql`${table.aiReplies} >= 0 AND ${table.callSeconds} >= 0`),
  ],
);
