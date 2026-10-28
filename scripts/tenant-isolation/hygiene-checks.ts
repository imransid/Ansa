// Hygiene checks (step 26): the Claude client never logs or traces, whatever
// the SDK's own environment variables say; rate limit keys can't be turned
// back into IP addresses or emails; an email that can't be decrypted is shown
// as unreadable, never as empty; account emails share one From header;
// received email content goes through one Zod schema, from the stand-in too;
// and the checks refuse to run against real services or a remote database.
// FAKE fetch and stand-in files only: nothing here calls Anthropic or Resend.

import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createClaudeClient } from "@/adapters/claude";
import { db } from "@/db/client";
import { saveInboundEmailTicket } from "@/db/inbound-email-processing";
import { insertInboundEmailIfNew } from "@/db/inbound-emails";
import { inboundEmails, rateLimits } from "@/db/schema";
import { encryptText } from "@/lib/encryption";
import { env } from "@/lib/env";
import { fetchInboundEmail } from "@/lib/inbound-email";
import { buildAccountEmailFromHeader, getSendingAddress } from "@/lib/send-email";
import { getOriginalEmailForSession } from "@/services/inbound-emails";
import { isOverRateLimit } from "@/services/rate-limit";
import { captureConsole, check, runId, sessionFor, type TestUser } from "./helpers";
import { findReasonNotToRunChecks } from "./local-only";

// A reply from Anthropic's Messages API, served by a fake fetch.
function fakeAnthropicFetch(answerText: string) {
  return async () =>
    new Response(
      JSON.stringify({
        id: "msg_fake",
        type: "message",
        role: "assistant",
        model: "claude-fake",
        content: [{ type: "text", text: answerText }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json", "request-id": "req_fake" } },
    );
}

// Sets environment variables for the length of `run`, then puts them back.
async function withEnvironment<T>(values: Record<string, string>, run: () => Promise<T>): Promise<T> {
  const before = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  Object.assign(process.env, values);
  try {
    return await run();
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

export async function runHygieneChecks(ownerA: TestUser) {
  await check("Claude client: logs nothing and traces nothing, even with ANTHROPIC_LOG=debug and content tracing switched on", async () => {
    const marker = `transcript-${runId}`;
    const sdkSwitches = { ANTHROPIC_LOG: "debug", ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE: "content" };
    const { result: client, logs } = await withEnvironment(sdkSwitches, () =>
      captureConsole(async () => {
        const fakeClient = createClaudeClient("sk-ant-fake").withOptions({ fetch: fakeAnthropicFetch(`answer ${marker}`), maxRetries: 0 });
        await fakeClient.messages.create({ model: "claude-fake", max_tokens: 10, messages: [{ role: "user", content: marker }] });
        return fakeClient;
      }),
    );
    assert.equal(client.logLevel, "off");
    assert.equal(client.openTelemetry.traces.enabled, false);
    assert.deepEqual(logs, [], "the SDK logged something");
  });

  await check("rate limits: keys are an HMAC with a server secret, never a plain hash of the IP address or email", async () => {
    const identifier = `isolation-${runId}-hmac@example.test`;
    await isOverRateLimit("hygiene-check", identifier, { maxAttempts: 5, windowSeconds: 60 });
    const plainKey = createHash("sha256").update(`hygiene-check:${identifier}`).digest("hex");
    const keySecret = createHmac("sha256", env.BETTER_AUTH_SECRET).update("ansa rate limit keys").digest();
    const hmacKey = createHmac("sha256", keySecret).update(`hygiene-check:${identifier}`).digest("hex");
    assert.equal((await db.select().from(rateLimits).where(eq(rateLimits.key, plainKey))).length, 0, "a plain SHA-256 key was stored");
    assert.equal((await db.select().from(rateLimits).where(eq(rateLimits.key, hmacKey))).length, 1);
    await db.delete(rateLimits).where(eq(rateLimits.key, hmacKey));
  });

  await check("original email: one that can't be decrypted shows as unreadable, never as an empty email, and nothing of it is logged", async () => {
    const emailId = await insertInboundEmailIfNew(ownerA.companyId, `unreadable-${runId}`);
    assert.ok(emailId);
    await db.update(inboundEmails).set({ status: "processing", processingStartedAt: new Date() }).where(eq(inboundEmails.id, emailId));
    // Encrypted for another record: it can't be decrypted for this one, like with a wrong key.
    const content = {
      fromAddress: `pat-${runId}@customer.test`,
      senderVerified: false,
      replyToAddress: null,
      subjectEncrypted: encryptText(`Refund ${runId}`, "another record"),
      bodyEncrypted: null,
      bodyFromHtml: false,
      attachmentCount: 0,
      attachmentNamesEncrypted: null,
      inlineImageCount: 0,
    };
    const ticket = { subject: "Unreadable", description: "x", channel: "email" as const, category: null, customerName: null, customerEmail: null, customerPhone: null };
    const saved = await saveInboundEmailTicket(ownerA.companyId, emailId, content, ticket);
    assert.ok(saved);
    const { result: original, logs } = await captureConsole(() => getOriginalEmailForSession(sessionFor(ownerA), saved.ticketId));
    assert.deepEqual([original?.unreadable, original?.subject, original?.body], [true, null, null]);
    assert.deepEqual(logs, ["Could not decrypt stored text: check DATA_ENCRYPTION_KEY"]);
  });

  await check("account emails: one From header, ansa's name on the shared sending address", async () => {
    assert.equal(buildAccountEmailFromHeader(), `"ansa" <${getSendingAddress()}>`);
  });

  await check("received email: the stand-in goes through the same schema; odd fields become empty, an email without a sender is still read", async () => {
    const folder = path.join(process.cwd(), ".dev-inbound");
    await mkdir(folder, { recursive: true });
    const standIns = {
      odd: { from: "Pat <pat@customer.test>", to: "c-x@inbound.test", subject: null, text: 42, headers: { "X-Ok": "yes", "X-List": ["a", "b"] } },
      "no-sender": { to: [], subject: "x" },
    };
    try {
      for (const [label, content] of Object.entries(standIns)) {
        await writeFile(path.join(folder, `zod-${label}-${runId}.json`), JSON.stringify(content));
      }
      const odd = await fetchInboundEmail(`zod-odd-${runId}`);
      assert.deepEqual(odd, { from: "Pat <pat@customer.test>", to: ["c-x@inbound.test"], subject: "", text: null, headers: { "X-Ok": "yes" }, authentication: null });
      // Step 27: no sender is no reason to lose the email (its ticket gets no customer email).
      assert.deepEqual(await fetchInboundEmail(`zod-no-sender-${runId}`), { from: "", to: [], subject: "x", text: null, headers: {}, authentication: null });
      assert.equal(await fetchInboundEmail("../../etc/passwd"), null);
    } finally {
      for (const label of Object.keys(standIns)) {
        await rm(path.join(folder, `zod-${label}-${runId}.json`), { force: true });
      }
    }
  });

  await check("checks: refuse to run with real email, R2 or Stripe on, a social platform's app set, or a database that isn't local", async () => {
    const local = { DATABASE_URL: "postgres://ansa@127.0.0.1:5432/ansa", SEND_REAL_EMAIL: "false", USE_R2_STORAGE: "false", USE_STRIPE: "false" };
    assert.equal(findReasonNotToRunChecks(local), null);
    assert.equal(findReasonNotToRunChecks({ DATABASE_URL: "postgres://u:p@LOCALHOST:5450/ansa" }), null);
    for (const flag of ["SEND_REAL_EMAIL", "USE_R2_STORAGE", "USE_STRIPE"]) {
      assert.match(findReasonNotToRunChecks({ ...local, [flag]: "true" }) ?? "", new RegExp(flag));
    }
    for (const app of ["LINKEDIN_CLIENT_ID", "FACEBOOK_APP_ID", "X_CLIENT_ID", "GOOGLE_CLIENT_ID"]) {
      const reason = findReasonNotToRunChecks({ ...local, [app]: `app-${runId}` }) ?? "";
      assert.match(reason, new RegExp(app));
      assert.ok(!reason.includes(runId), "the reason repeats the setting's value");
    }
    const remote = findReasonNotToRunChecks({ ...local, DATABASE_URL: `postgres://u:secret-${runId}@ep-x.eu-central-1.aws.neon.tech/db` });
    assert.match(remote ?? "", /DATABASE_URL/);
    assert.ok(!remote?.includes(runId), "the reason repeats the database URL");
    assert.match(findReasonNotToRunChecks({ ...local, DATABASE_URL: "not a url" }) ?? "", /DATABASE_URL/);
    assert.equal(findReasonNotToRunChecks(process.env), null, "these very checks run with unsafe settings");
  });
}
