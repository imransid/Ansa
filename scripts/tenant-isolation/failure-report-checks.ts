// Failure report checks (step 32): what a failure tells people is what really
// happened. "Analyze now" says when nothing could be saved instead of
// reporting success, and a failed claim is a failure, not "already analyzed";
// Billing never shows developer buttons in production and
// tells an owner when Stripe failed; X-Powered-By is off. FAKE model and FAKE
// Stripe answers only: no paid or outside calls.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { createPhoneLine } from "@/db/phone-lines";
import { calls, tickets } from "@/db/schema";
import { analyzeCall, analyzeCallForSession } from "@/services/call-analysis";
import { askStripeForPage, billingModeFor } from "@/services/billing";
import nextConfig from "../../next.config";
import { answer } from "./brain-guard-checks";
import { fakeModel, saveTestCall } from "./brain-test-calls";
import { captureConsole, check, runId, sessionFor, signUpTestOwner } from "./helpers";

const needsHuman = () =>
  answer({ outcome: "needs_human", customer_issue: "Wants a refund.", resolution_evidence: "", reason: "Refunds need a person.", ticket_subject: "Refund" });

// Puts a decided call back to "not analyzed" while its ticket stays, so the
// next decision can't save its ticket (one ticket per call): the only way to
// make every save fail on purpose.
async function undecide(callId: string): Promise<void> {
  await db
    .update(calls)
    .set({
      analysisStatus: "pending",
      aiOutcome: null,
      aiDecisionSource: null,
      aiReasonCode: null,
      aiModel: null,
      aiErrorClass: null,
      aiIssueEncrypted: null,
      aiExplanationEncrypted: null,
      aiEvidenceEncrypted: null,
      decidedAt: null,
    })
    .where(eq(calls.id, callId));
}

export async function runFailureReportChecks() {
  await check("brain: when even the fallback decision can't be saved, analysis says 'failed' and Analyze now says so", async () => {
    const owner = await signUpTestOwner("unsaved-decision");
    const line = await createPhoneLine(owner.companyId, `pn-unsaved-${runId}`);
    const callId = await saveTestCall(line.vapiPhoneNumberId, "User: I want a refund for my order.", "+1 555 0142");
    assert.equal(await analyzeCall(owner.companyId, callId, fakeModel(needsHuman()).ask), "decided");
    assert.equal((await db.select().from(tickets).where(eq(tickets.callId, callId))).length, 1);

    await undecide(callId);
    const { result, logs } = await captureConsole(() => analyzeCall(owner.companyId, callId, fakeModel(needsHuman()).ask));
    assert.equal(result, "failed");
    assert.ok(logs.includes("Could not store the fallback decision"));
    assert.ok(logs.every((line) => !line.includes("refund") && !line.includes("555")), "call data was logged");

    await undecide(callId);
    const fromPage = await captureConsole(() => analyzeCallForSession(sessionFor(owner), { callId }, fakeModel(needsHuman()).ask));
    assert.deepEqual(fromPage.result, { ok: false, errors: { message: "The analysis failed and nothing could be saved. Try again in a few minutes." } });
    const [call] = await db.select().from(calls).where(eq(calls.id, callId));
    assert.equal(call.analysisStatus, "analyzing", "a failed analysis must not look decided");
  });

  await check("brain: when claiming the call itself fails, analysis says 'failed', never 'already analyzed'", async () => {
    const owner = await signUpTestOwner("claim-fails");
    const model = fakeModel(needsHuman());
    // Not a uuid: Postgres refuses the claim's own query, as it would in an outage.
    const { result, logs } = await captureConsole(() => analyzeCall(owner.companyId, "not-a-uuid", model.ask));
    assert.equal(result, "failed");
    assert.equal(model.calls, 0, "the model was asked about a call that was never claimed");
    assert.ok(logs.some((line) => line.startsWith("Call analysis failed: ")));
    assert.ok(logs.every((line) => !line.includes("not-a-uuid")), "the query's values were logged");
  });

  await check("billing: with Stripe off in production the page is 'not set up yet', never the simulate buttons", async () => {
    assert.equal(billingModeFor(undefined, "production"), "off");
    assert.equal(billingModeFor("false", "production"), "off");
    assert.equal(billingModeFor(undefined, "development"), "dev");
    assert.equal(billingModeFor(undefined, undefined), "dev");
    assert.equal(billingModeFor("true", "production"), "stripe");
    assert.equal(billingModeFor("true", "development"), "stripe");
  });

  await check("billing: Stripe failing on Subscribe or Manage billing is a message on the page, and Stripe's words are not logged", async () => {
    const stripeFails = async (): Promise<string> => {
      throw new Error(`No configuration provided for cus_${runId}`);
    };
    for (const page of ["checkout", "portal"] as const) {
      const { result, logs } = await captureConsole(() => askStripeForPage(page, stripeFails));
      assert.equal(result.ok, false);
      assert.match(result.ok ? "" : (result.errors.message ?? ""), /^Stripe could not open the (payment|billing) page right now/);
      // One log entry: the class on its first line, then only stack frames.
      assert.equal(logs.length, 1);
      const [firstLine, ...frames] = logs[0].split("\n");
      assert.equal(firstLine, `Stripe ${page} failed: Error`);
      assert.ok(frames.every((frame) => frame.trimStart().startsWith("at ")) && !logs[0].includes(runId), logs[0]);
    }
    assert.deepEqual(await askStripeForPage("portal", async () => "https://billing.stripe.test/session"), { ok: true, url: "https://billing.stripe.test/session" });
  });

  await check("next.config: answers don't announce Next.js (no X-Powered-By header)", async () => {
    assert.equal(nextConfig.poweredByHeader, false);
  });
}
