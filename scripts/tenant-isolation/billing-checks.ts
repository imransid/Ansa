// Billing checks (step 18): only owners see or change billing, nothing can be
// charged while Stripe is off, only signed Stripe webhooks are accepted, the
// company comes from what we put on the checkout, billing never moves between
// companies, and a late event about an old subscription can't undo a new one.
// FAKE Stripe only: no network calls.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { signLikeStripe } from "@/adapters/stripe";
import type { SubscriptionSnapshot } from "@/db/billing";
import { parseEnv } from "@/lib/env";
import { getBillingForSession, openBillingPortalForSession, simulateSubscriptionForSession, startCheckoutForSession } from "@/services/billing";
import { handleStripeWebhook } from "@/services/stripe-webhook";
import { addTeammate, captureConsole, check, runId, sessionFor, type TestUser } from "./helpers";

const secret = `whsec_test_${randomUUID()}`;

type FakeSubscription = SubscriptionSnapshot & { companyId: string | undefined };

function event(type: string, object: Record<string, unknown>) {
  return Buffer.from(JSON.stringify({ id: `evt_${randomUUID()}`, object: "event", type, data: { object } }));
}

async function post(body: Buffer, signature: string | null, subscription?: FakeSubscription) {
  const asked: string[] = [];
  const headers: Record<string, string> = signature ? { "stripe-signature": signature } : {};
  const request = new Request("http://localhost/api/webhooks/stripe", { method: "POST", headers, body: new Uint8Array(body) });
  const retrieve = async (id: string) => {
    asked.push(id);
    assert.ok(subscription, "Stripe was asked for a subscription");
    return subscription;
  };
  const { result, logs } = await captureConsole(async () => (await handleStripeWebhook(request, { secret, retrieve })).status);
  return { status: result, logs, asked };
}

const signed = (body: Buffer, at?: Date) => signLikeStripe(body, secret, at);

export async function runBillingChecks(ownerA: TestUser, ownerB: TestUser) {
  const owner = sessionFor(ownerA);
  const member = sessionFor(await addTeammate(ownerA, "billing-member", "member"));
  const customerB = `cus_b_${runId}`;
  const subscriptionB = (id: string, overrides: Partial<FakeSubscription> = {}): FakeSubscription => ({
    stripeCustomerId: customerB,
    stripeSubscriptionId: id,
    status: "active",
    currentPeriodEnd: new Date(Date.now() + 86_400_000),
    cancelAtPeriodEnd: false,
    companyId: ownerB.companyId,
    ...overrides,
  });

  await check("billing: USE_STRIPE=true without every Stripe setting refuses to start", async () => {
    const stripeOff = { ...process.env, USE_STRIPE: undefined, STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined, STRIPE_PRICE_ID: undefined };
    assert.throws(() => parseEnv({ ...stripeOff, USE_STRIPE: "true", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x" }), /STRIPE_PRICE_ID/);
    assert.throws(() => parseEnv({ ...stripeOff, STRIPE_SECRET_KEY: "pk_test_publishable" }), /STRIPE_SECRET_KEY/);
    assert.equal(parseEnv({ ...stripeOff, USE_STRIPE: "true", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x", STRIPE_PRICE_ID: "price_x" }).USE_STRIPE, "true");
  });

  await check("billing: members can't see or change billing", async () => {
    assert.equal(await getBillingForSession(member), null);
    const attempts = [await startCheckoutForSession(member), await openBillingPortalForSession(member), await simulateSubscriptionForSession(member, { status: "active" })];
    assert.ok(attempts.every((attempt) => !attempt.ok));
    assert.equal((await getBillingForSession(owner))?.subscription, null);
  });

  await check("billing: with Stripe off nothing can be charged, and simulating stays in one company", async () => {
    assert.equal((await getBillingForSession(owner))?.mode, "dev");
    assert.equal((await startCheckoutForSession(owner)).ok, false);
    assert.equal((await simulateSubscriptionForSession(owner, { status: "free-forever" })).ok, false);
    assert.equal((await simulateSubscriptionForSession(owner, { status: "active" })).ok, true);
    assert.equal((await getBillingForSession(owner))?.isLive, true);
    assert.equal((await getBillingForSession(sessionFor(ownerB)))?.subscription, null);
  });

  await check("stripe webhook: unsigned, wrongly signed, tampered and stale requests get 401", async () => {
    const body = event("checkout.session.completed", { mode: "subscription", client_reference_id: ownerB.companyId, subscription: `sub_x_${runId}` });
    const attempts = [
      await post(body, null),
      await post(body, signLikeStripe(body, `whsec_wrong_${randomUUID()}`)),
      await post(Buffer.from(body.toString().replace("subscription\"", "subscriptionX\"")), signed(body)),
      await post(body, signed(body, new Date(Date.now() - 10 * 60 * 1000))),
    ];
    for (const attempt of attempts) {
      assert.equal(attempt.status, 401);
      assert.deepEqual(attempt.logs, ["Stripe webhook rejected: invalid signature"]);
      assert.equal(attempt.asked.length, 0);
    }
    assert.equal((await getBillingForSession(sessionFor(ownerB)))?.subscription, null);
  });

  await check("stripe webhook: a finished checkout stores Stripe's current state for the company on it", async () => {
    const body = event("checkout.session.completed", { mode: "subscription", client_reference_id: ownerB.companyId, subscription: `sub_new_${runId}` });
    const answer = await post(body, signed(body), subscriptionB(`sub_new_${runId}`));
    assert.equal(answer.status, 200);
    assert.deepEqual(answer.asked, [`sub_new_${runId}`]);
    assert.ok(answer.logs.every((line) => !line.includes(runId)), "an id was logged");
    const billing = await getBillingForSession(sessionFor(ownerB));
    assert.equal(billing?.subscription?.status, "active");
    assert.equal(billing?.subscription?.stripeCustomerId, customerB);
    assert.equal((await getBillingForSession(owner))?.subscription?.stripeCustomerId, `dev_cus_${ownerA.companyId}`);
  });

  await check("stripe webhook: billing never moves to another company", async () => {
    const body = event("customer.subscription.updated", { id: `sub_new_${runId}` });
    // Company A's id on company B's Stripe customer: refused.
    const moved = await post(body, signed(body), subscriptionB(`sub_new_${runId}`, { companyId: ownerA.companyId, status: "canceled" }));
    assert.equal(moved.status, 200);
    assert.equal((await getBillingForSession(owner))?.subscription?.status, "active");
    assert.equal((await getBillingForSession(sessionFor(ownerB)))?.subscription?.status, "active");
  });

  await check("stripe webhook: a late cancel of an old subscription can't undo the new one; updates still apply", async () => {
    const late = event("customer.subscription.deleted", { id: `sub_old_${runId}` });
    await post(late, signed(late), subscriptionB(`sub_old_${runId}`, { status: "canceled" }));
    const billing = await getBillingForSession(sessionFor(ownerB));
    assert.equal(billing?.subscription?.stripeSubscriptionId, `sub_new_${runId}`);
    assert.equal(billing?.subscription?.status, "active");

    const update = event("customer.subscription.updated", { id: `sub_new_${runId}` });
    await post(update, signed(update), subscriptionB(`sub_new_${runId}`, { status: "past_due" }));
    assert.equal((await getBillingForSession(sessionFor(ownerB)))?.subscription?.status, "past_due");

    const other = event("invoice.paid", { id: `in_${runId}` });
    assert.equal((await post(other, signed(other))).status, 200);
  });
}
