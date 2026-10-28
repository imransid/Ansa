// Ops readiness checks (step 33), part 2: the daily cleanup deletes in
// bounded batches; failures caught away from call and email content log the
// class, Postgres code, constraint and stack frames, never the message; link
// lifetimes in emails and pages come from what Better Auth enforces;
// robots.txt and sitemap.xml are made per request; CI checks schema drift and
// audits; and the new company-scoped reads (any ticket yet, a number's newest
// call) stay inside their company. FAKE Stripe API only.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { signLikeStripe } from "@/adapters/stripe";
import { insertCallIfNew } from "@/db/calls";
import { db } from "@/db/client";
import { createPhoneLine } from "@/db/phone-lines";
import { calls, rateLimits } from "@/db/schema";
import { companyHasTickets } from "@/db/tickets";
import { auth } from "@/lib/auth";
import { renderResetPasswordEmail } from "@/lib/emails/reset-password";
import { renderVerifyEmail } from "@/lib/emails/verify-email";
import { describeLinkLifetime, PASSWORD_RESET_LINK_SECONDS, VERIFICATION_LINK_SECONDS } from "@/lib/link-lifetimes";
import { describeErrorWithFrames } from "@/lib/safe-error-logging";
import { getFirstRunHintsForSession } from "@/services/dashboard";
import { handleCleanupRequest, runCleanup } from "@/services/maintenance";
import { longestRateLimitWindowSeconds } from "@/services/rate-limit";
import { getSetupForSession } from "@/services/setup";
import { handleStripeWebhook } from "@/services/stripe-webhook";
import { createTicketForCompany } from "@/services/tickets";
import { captureConsole, check, runId, sessionFor, signUpTestOwner, type TestUser } from "./helpers";

const ROOT = process.cwd();
const secretText = `+1555${runId}`;
const DESCRIBED = "Error <- Error (code 23505, constraint tickets_call_id_unique)";

function read(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

// A Drizzle-like failure whose messages hold customer data.
function databaseLikeError(): Error {
  const postgresError = Object.assign(new Error(`duplicate key ${secretText}`), { code: "23505", constraint: "tickets_call_id_unique" });
  return new Error(`Failed query: insert into tickets params: ${secretText}`, { cause: postgresError });
}

// Rate limit counters whose window ended days ago, one per key.
async function insertStaleCounters(label: string, count: number): Promise<string[]> {
  const keys = Array.from({ length: count }, (_, index) => `${label}-${runId}-${index}`);
  const longAgo = new Date(Date.now() - (longestRateLimitWindowSeconds() + 3 * 24 * 60 * 60) * 1000);
  await db.insert(rateLimits).values(keys.map((key) => ({ key, attemptCount: 1, windowStartedAt: longAgo })));
  return keys;
}

async function countersLeft(keys: string[]): Promise<number> {
  return (await db.select({ key: rateLimits.key }).from(rateLimits).where(inArray(rateLimits.key, keys))).length;
}

// One log entry of a caught failure: the description, then only stack frames.
function assertDescribedWithFrames(entry: string | undefined, prefix: string) {
  assert.ok(entry, `nothing was logged for ${prefix}`);
  const [firstLine, ...frames] = entry.split("\n");
  assert.equal(firstLine, `${prefix}${DESCRIBED}`);
  assert.ok(frames.length > 0 && frames.every((frame) => frame.startsWith("    at ")), entry);
  assert.ok(!entry.includes(secretText), "an error's message was logged");
}

// Saves a call on one of the company's numbers, as saved `minutesAgo` minutes ago.
async function callSavedMinutesAgo(companyId: string, phoneLineId: string, label: string, minutesAgo: number): Promise<Date> {
  const callId = await insertCallIfNew(companyId, { phoneLineId, vapiCallId: `vc-${label}-${runId}`, callerNumber: null, startedAt: null, endedAt: null, endedReason: null, transcriptEncrypted: null });
  assert.ok(callId, "the call was not saved");
  const savedAt = new Date(Date.now() - minutesAgo * 60 * 1000);
  await db.update(calls).set({ createdAt: savedAt }).where(eq(calls.id, callId));
  return savedAt;
}

export async function runOpsMaintenanceChecks(ownerB: TestUser) {
  await check("cleanup: deletes old rows in batches until none is left, counting them without reading them back", async () => {
    const keys = await insertStaleCounters("batched", 5);
    const counts = await runCleanup({ batchSize: 2 });
    assert.ok(counts.rateLimitCounters >= 5, JSON.stringify(counts));
    assert.equal(await countersLeft(keys), 0);
    assert.doesNotMatch(await read("db/maintenance.ts"), /\.returning\(/, "a cleanup delete reads its rows back");
  });

  await check("cleanup: a table out of time stops after its batch and says so; the next run finishes it", async () => {
    const keys = await insertStaleCounters("timed-out", 5);
    const first = await captureConsole(() => runCleanup({ batchSize: 2, secondsPerTable: 0 }));
    assert.equal(first.result.rateLimitCounters, 2, "more than one batch ran");
    assert.ok(first.logs.includes("Cleanup stopped at its time limit: old rate limit counters are left for the next run"), first.logs.join("\n"));
    assert.ok((await countersLeft(keys)) >= 3);
    await runCleanup();
    assert.equal(await countersLeft(keys), 0);
  });

  await check("logging: failures caught away from call and email content log class, Postgres code, constraint and stack frames, never the message", async () => {
    assertDescribedWithFrames(describeErrorWithFrames(databaseLikeError()), "");
    const cronSecret = `cron-${runId}`.padEnd(40, "x");
    const cronRequest = new Request("http://localhost/api/cron/cleanup", { headers: { authorization: `Bearer ${cronSecret}`, "x-forwarded-for": `cron-${runId}` } });
    const noPublishing = async () => ({ interrupted: 0, published: 0, failed: 0, needsAttention: 0, requeued: 0 });
    const noMetrics = async () => ({ collected: 0, failed: 0, skipped: 0 });
    const cron = await captureConsole(() => handleCleanupRequest(cronRequest, cronSecret, async () => Promise.reject(databaseLikeError()), undefined, noPublishing, noMetrics));
    assert.equal(cron.result.status, 500);
    assertDescribedWithFrames(cron.logs.at(-1), "Cleanup failed: ");
    const stripeSecret = `whsec_ops_${runId}`;
    const body = Buffer.from(JSON.stringify({ type: "customer.subscription.updated", data: { object: { id: `sub_ops_${runId}` } } }));
    const headers = { "stripe-signature": signLikeStripe(body, stripeSecret), "x-forwarded-for": `stripe-${runId}` };
    const stripeRequest = new Request("http://localhost/api/webhooks/stripe", { method: "POST", headers, body: new Uint8Array(body) });
    const stripe = await captureConsole(() => handleStripeWebhook(stripeRequest, { secret: stripeSecret, retrieve: async () => Promise.reject(databaseLikeError()) }));
    assert.equal(stripe.result.status, 500);
    assertDescribedWithFrames(stripe.logs.at(-1), "Stripe webhook failed: ");
  });

  await check("link lifetimes: emails and pages say how long a link works from the numbers Better Auth enforces", async () => {
    assert.deepEqual([3600, 7200, 1800, 60].map(describeLinkLifetime), ["one hour", "2 hours", "30 minutes", "one minute"]);
    assert.equal(auth.options.emailVerification?.expiresIn, VERIFICATION_LINK_SECONDS);
    assert.equal(auth.options.emailAndPassword?.resetPasswordTokenExpiresIn, PASSWORD_RESET_LINK_SECONDS);
    assert.ok(renderVerifyEmail({ link: "x" }).text.includes(`The link works for ${describeLinkLifetime(VERIFICATION_LINK_SECONDS)}.`));
    assert.ok(renderResetPasswordEmail({ link: "x" }).text.includes(`The link works once, for ${describeLinkLifetime(PASSWORD_RESET_LINK_SECONDS)}.`));
    for (const file of ["app/check-email/page.tsx", "app/forgot-password/forgot-password-form.tsx", "lib/emails/verify-email.ts", "lib/emails/reset-password.ts"]) {
      assert.doesNotMatch(await read(file), /one hour/, `${file} writes the lifetime out by hand`);
    }
  });

  await check("robots.txt and sitemap.xml are made per request, from the running server's BETTER_AUTH_URL", async () => {
    for (const file of ["app/robots.ts", "app/sitemap.ts"]) {
      const source = await read(file);
      assert.match(source, /await connection\(\);/, file);
      assert.match(source, /env\.BETTER_AUTH_URL/, file);
    }
    assert.match(await read("app/api/health/route.ts"), /await connection\(\);\s+return handleHealthCheck\(request\);/);
  });

  await check("CI and packages: migrations must match db/schema, production dependencies are audited, Node is pinned, build-only packages are dev dependencies", async () => {
    const workflow = await read(".github/workflows/checks.yml");
    for (const step of [/pnpm db:generate --name schema_drift_check/, /grep -q "No schema changes"/, /pnpm audit --prod --audit-level high/, /permissions:\s+contents: read/]) {
      assert.match(workflow, step);
    }
    const manifest = JSON.parse(await read("package.json"));
    assert.equal(manifest.engines?.node, "22.x");
    for (const name of ["shadcn", "tw-animate-css"]) {
      assert.equal(manifest.dependencies[name], undefined, `${name} is a production dependency`);
      assert.ok(manifest.devDependencies[name], `${name} is missing`);
    }
  });

  await check("dashboard: whether a company has a ticket yet is read for that company only (one row, not the counts)", async () => {
    const fresh = await signUpTestOwner("ops-fresh");
    await createTicketForCompany(ownerB.companyId, { subject: "B has one", description: "x", channel: "phone" });
    assert.equal(await companyHasTickets(fresh.companyId), false, "another company's tickets counted");
    assert.equal(await companyHasTickets(ownerB.companyId), true);
    assert.equal(typeof (await getFirstRunHintsForSession(sessionFor(fresh))).setupStepsLeft, "number");
    await createTicketForCompany(fresh.companyId, { subject: "First", description: "x", channel: "phone" });
    assert.equal(await companyHasTickets(fresh.companyId), true);
    assert.equal((await getFirstRunHintsForSession(sessionFor(fresh))).setupStepsLeft, null);
  });

  await check("setup: a number's last call is its newest call, and another company's calls never count", async () => {
    const owner = await signUpTestOwner("ops-lines");
    const line = await createPhoneLine(owner.companyId, `pn-newest-${runId}`);
    await callSavedMinutesAgo(owner.companyId, line.id, "older", 3);
    const newest = await callSavedMinutesAgo(owner.companyId, line.id, "newer", 1);
    const lineOfB = await createPhoneLine(ownerB.companyId, `pn-newest-b-${runId}`);
    await callSavedMinutesAgo(ownerB.companyId, lineOfB.id, "other-company", 0);
    const overview = (await getSetupForSession(sessionFor(owner))).phoneLines;
    assert.deepEqual(overview.map((entry) => entry.vapiPhoneNumberId), [`pn-newest-${runId}`]);
    assert.equal(overview[0].lastCallAt?.getTime(), newest.getTime());
  });
}
