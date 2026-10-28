import "server-only";
import { eq, inArray, not, or, sql } from "drizzle-orm";
import { db } from "./client";
import { companyBilling, type SubscriptionStatus } from "./schema";

export type SubscriptionSnapshot = {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

// Statuses where the company still has (or is about to have) a working plan.
export const LIVE_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ["trialing", "active", "past_due", "unpaid", "paused"];

// Reads one company's subscription, if it ever had one.
export async function getCompanyBilling(companyId: string): Promise<SubscriptionSnapshot | undefined> {
  const [row] = await db
    .select({
      stripeCustomerId: companyBilling.stripeCustomerId,
      stripeSubscriptionId: companyBilling.stripeSubscriptionId,
      status: companyBilling.status,
      currentPeriodEnd: companyBilling.currentPeriodEnd,
      cancelAtPeriodEnd: companyBilling.cancelAtPeriodEnd,
    })
    .from(companyBilling)
    .where(eq(companyBilling.companyId, companyId));
  return row;
}

// Saves the latest state of one company's subscription. A DIFFERENT
// subscription only replaces the stored one when the stored one is no longer
// live, so a late "old subscription canceled" event can't undo a new one.
// Returns false when it was not saved for that reason.
export async function saveCompanySubscription(companyId: string, snapshot: SubscriptionSnapshot): Promise<boolean> {
  // Every column is named here, so company_id only ever comes from the
  // companyId argument. Spreading the snapshot would let an object with extra
  // fields (such as a company id read from Stripe's metadata) pick the company.
  const subscription = {
    stripeCustomerId: snapshot.stripeCustomerId,
    stripeSubscriptionId: snapshot.stripeSubscriptionId,
    status: snapshot.status,
    currentPeriodEnd: snapshot.currentPeriodEnd,
    cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
  };
  const saved = await db
    .insert(companyBilling)
    .values({ ...subscription, companyId })
    .onConflictDoUpdate({
      target: companyBilling.companyId,
      set: { ...subscription, updatedAt: sql`now()` },
      setWhere: or(
        eq(companyBilling.stripeSubscriptionId, snapshot.stripeSubscriptionId),
        not(inArray(companyBilling.status, LIVE_SUBSCRIPTION_STATUSES)),
      ),
    })
    .returning({ companyId: companyBilling.companyId });
  return saved.length > 0;
}

// Finds which company a Stripe customer belongs to.
// Not company-scoped on purpose: a webhook has no session. Call this only
// after the Stripe webhook signature is verified.
export async function findCompanyForStripeCustomer(stripeCustomerId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ companyId: companyBilling.companyId })
    .from(companyBilling)
    .where(eq(companyBilling.stripeCustomerId, stripeCustomerId));
  return row?.companyId;
}
