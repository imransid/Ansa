// Billing company checks (step 26): only our checkout's own event can give a
// company its first billing row. So when the checkout's company id and the
// subscription's metadata disagree nothing is stored, for either company,
// whichever event arrives first; a subscription event that beats its checkout
// is ignored, and the checkout then stores Stripe's current state; a checkout
// without metadata (a payment link) is stored for the checkout's company and
// never answers 500, and its later events follow the Stripe customer; a
// company paying twice (two tabs, a slow webhook) keeps its first
// subscription and the second is logged with a fixed line, and the page
// doesn't offer Subscribe while a payment is being confirmed; and the webhook
// rate-limits after the signature but before parsing anything, with a log
// line. FAKE Stripe only: no network calls.

import assert from "node:assert/strict";
import type { SubscriptionSnapshot } from "@/db/billing";
import { getBillingForSession } from "@/services/billing";
import { isOverRateLimit, RATE_LIMITS } from "@/services/rate-limit";
import { check, runId, sessionFor, signUpTestOwner, type TestUser } from "./helpers";
import { fakeSubscription, postToStripeWebhook, signedLikeStripe, stripeEvent } from "./stripe-helpers";

const CUSTOMER_NOT_KNOWN = "Stripe webhook ignored: customer not known yet";

function snapshotFor(label: string, overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return {
    stripeCustomerId: `cus_${label}_${runId}`,
    stripeSubscriptionId: `sub_${label}_${runId}`,
    status: "active",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

function checkoutCompleted(companyId: string, subscriptionId: string): Buffer {
  return stripeEvent("checkout.session.completed", { mode: "subscription", client_reference_id: companyId, subscription: subscriptionId });
}

function subscriptionEvent(type: string, subscriptionId: string): Buffer {
  return stripeEvent(type, { id: subscriptionId });
}

async function billingOf(user: TestUser) {
  return (await getBillingForSession(sessionFor(user)))?.subscription ?? null;
}

export async function runBillingCompanyChecks(ownerB: TestUser) {
  const ownerC = await signUpTestOwner("billing-c");

  await check("billing page: back from a paid checkout whose event hasn't arrived yet, Subscribe is not offered again (it would charge twice)", async () => {
    const confirming = await getBillingForSession(sessionFor(ownerC), true);
    assert.deepEqual([confirming?.isLive, confirming?.confirmingPayment, confirming?.offersCheckout], [false, true, false]);
    const opened = await getBillingForSession(sessionFor(ownerC));
    assert.deepEqual([opened?.confirmingPayment, opened?.offersCheckout], [false, true]);
  });

  await check("stripe webhook: a checkout for one company whose subscription names another stores nothing, for either, whichever event comes first", async () => {
    const billingOfB = await billingOf(ownerB);
    const snapshot = snapshotFor("mismatch");
    // The metadata names C, which has no billing yet: nothing but the
    // webhook's own rules keeps this subscription off C.
    const subscription = fakeSubscription(snapshot, ownerC.companyId);
    const events = [
      subscriptionEvent("customer.subscription.created", snapshot.stripeSubscriptionId),
      checkoutCompleted(ownerB.companyId, snapshot.stripeSubscriptionId),
      subscriptionEvent("customer.subscription.updated", snapshot.stripeSubscriptionId),
    ];
    const logs: string[][] = [];
    for (const body of events) {
      const answer = await postToStripeWebhook(body, signedLikeStripe(body), subscription);
      assert.equal(answer.status, 200);
      logs.push(answer.logs);
    }
    assert.deepEqual(logs, [[CUSTOMER_NOT_KNOWN], ["Stripe webhook ignored: checkout and subscription name different companies"], [CUSTOMER_NOT_KNOWN]]);
    assert.equal(await billingOf(ownerC), null);
    assert.deepEqual(await billingOf(ownerB), billingOfB);
  });

  await check("stripe webhook: a checkout without metadata is stored for its company (never a 500), and later events follow the Stripe customer", async () => {
    const snapshot = snapshotFor("no-metadata");
    const body = checkoutCompleted(ownerC.companyId, snapshot.stripeSubscriptionId);
    const answer = await postToStripeWebhook(body, signedLikeStripe(body), fakeSubscription(snapshot, undefined));
    assert.equal(answer.status, 200);
    assert.equal((await billingOf(ownerC))?.stripeSubscriptionId, snapshot.stripeSubscriptionId);
    // A cancellation carries no company id at all: it goes to the company that owns the Stripe customer.
    const cancel = subscriptionEvent("customer.subscription.updated", snapshot.stripeSubscriptionId);
    const canceled = await postToStripeWebhook(cancel, signedLikeStripe(cancel), fakeSubscription({ ...snapshot, status: "canceled" }, undefined));
    assert.equal(canceled.status, 200);
    assert.equal((await billingOf(ownerC))?.status, "canceled");
  });

  await check("stripe webhook: a subscription event that beats its checkout is ignored, and the checkout then stores Stripe's current state", async () => {
    // C's only subscription is canceled by now, so a new one may replace it.
    const snapshot = snapshotFor("reordered", { status: "incomplete" });
    const created = subscriptionEvent("customer.subscription.created", snapshot.stripeSubscriptionId);
    const early = await postToStripeWebhook(created, signedLikeStripe(created), fakeSubscription(snapshot, ownerC.companyId));
    assert.deepEqual([early.status, early.logs], [200, [CUSTOMER_NOT_KNOWN]]);
    assert.equal((await billingOf(ownerC))?.status, "canceled");
    // By the time the checkout's event arrives, Stripe has the payment.
    const checkout = checkoutCompleted(ownerC.companyId, snapshot.stripeSubscriptionId);
    const paid = fakeSubscription({ ...snapshot, status: "active" }, ownerC.companyId);
    assert.equal((await postToStripeWebhook(checkout, signedLikeStripe(checkout), paid)).status, 200);
    const stored = await billingOf(ownerC);
    assert.deepEqual([stored?.stripeSubscriptionId, stored?.status], [snapshot.stripeSubscriptionId, "active"]);
  });

  await check("stripe webhook: a second paid checkout of a company with a live subscription is not stored and logs one fixed line; a late cancel of an old one logs nothing", async () => {
    const stored = await billingOf(ownerC);
    assert.equal(stored?.status, "active");
    // Paid in a second tab: Stripe made a new customer and a second subscription.
    const second = snapshotFor("second-checkout");
    const checkout = checkoutCompleted(ownerC.companyId, second.stripeSubscriptionId);
    const paidTwice = await postToStripeWebhook(checkout, signedLikeStripe(checkout), fakeSubscription(second, ownerC.companyId));
    assert.deepEqual([paidTwice.status, paidTwice.logs], [200, ["Stripe webhook ignored: company already has another live subscription"]]);
    assert.deepEqual(await billingOf(ownerC), stored);
    const oldOne = { ...snapshotFor("old-of-c", { status: "canceled" }), stripeCustomerId: stored?.stripeCustomerId ?? "" };
    const cancel = subscriptionEvent("customer.subscription.deleted", oldOne.stripeSubscriptionId);
    const lateCancel = await postToStripeWebhook(cancel, signedLikeStripe(cancel), fakeSubscription(oldOne, ownerC.companyId));
    assert.deepEqual([lateCancel.status, lateCancel.logs, await billingOf(ownerC)], [200, [], stored]);
    const page = await getBillingForSession(sessionFor(ownerC), true);
    assert.deepEqual([page?.confirmingPayment, page?.offersCheckout], [false, false]);
  });

  await check("stripe webhook: rate limited after the signature and before any parsing, with a log line", async () => {
    const throttledAddress = `isolation-${runId}-stripe-throttled`;
    const rule = RATE_LIMITS.stripeWebhookPerIp;
    for (let attempt = 0; attempt < rule.maxAttempts; attempt++) {
      await isOverRateLimit("stripe-webhook", throttledAddress, rule);
    }
    // Signed, but not even JSON: a 429 and not a 400 shows nothing was parsed first.
    const notJson = Buffer.from(`not json ${runId}`);
    const throttled = await postToStripeWebhook(notJson, signedLikeStripe(notJson), undefined, { "x-forwarded-for": throttledAddress });
    assert.equal(throttled.status, 429);
    assert.deepEqual(throttled.logs, ["Stripe webhook rejected: rate limited"]);
    // Unsigned requests are refused before they count.
    assert.equal((await postToStripeWebhook(notJson, null, undefined, { "x-forwarded-for": throttledAddress })).status, 401);
    // From another address the same body is parsed, and refused as not an event.
    const parsed = await postToStripeWebhook(notJson, signedLikeStripe(notJson), undefined, { "x-forwarded-for": `isolation-${runId}-stripe-other` });
    assert.equal(parsed.status, 400);
    assert.deepEqual(parsed.logs, ["Stripe webhook rejected: not a Stripe event"]);
  });
}
