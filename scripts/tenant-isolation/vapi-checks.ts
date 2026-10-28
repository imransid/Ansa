// Vapi webhook checks: only correctly signed, recent requests are accepted
// (the signature headers default to a Vapi HMAC credential's own), calls land
// in the company that owns the phone line, transcripts are encrypted (a cut
// authentication tag is refused), and no call data ever reaches the logs.

import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { createPhoneLine } from "@/db/phone-lines";
import { calls } from "@/db/schema";
import { decryptText, encryptText } from "@/lib/encryption";
import { parseEnv } from "@/lib/env";
import { getVapiSignatureSettings, isValidVapiSignature, signLikeVapi } from "@/lib/vapi-signature";
import { getCallForSession, listCallsForSession } from "@/services/calls";
import { handleVapiWebhook } from "@/services/vapi-webhook";
import { buildSampleEndOfCallReport } from "../vapi-sample";
import { check, runId, sessionFor, type TestUser } from "./helpers";

const settings = getVapiSignatureSettings();
const secretPhrase = `secret-phrase-${runId}`;
const callerNumber = `+1 555 01${Math.floor(Math.random() * 90 + 10)}`;
const allLogs: string[] = [];
// Analyses the webhook asked to run after responding. Recorded, NEVER run:
// running them would call the real, paid Claude API. brain-checks.ts tests
// the analysis itself with a fake model.
let scheduledAnalyses = 0;
const recordInsteadOfRunning = () => {
  scheduledAnalyses += 1;
};

function reportBody(phoneNumberId: string, callId: string, endedReason = "customer-ended-call"): Buffer {
  const report = buildSampleEndOfCallReport({ callId, phoneNumberId, callerNumber, transcript: `User: ${secretPhrase}` });
  report.message.endedReason = endedReason;
  return Buffer.from(JSON.stringify(report), "utf8");
}

// Calls the real handler and records everything it printed.
async function send(body: Buffer, headers: Record<string, string>): Promise<{ status: number; logs: string[] }> {
  const logs: string[] = [];
  const originals = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  const record = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  Object.assign(console, { log: record, info: record, warn: record, error: record, debug: record });
  try {
    const request = new Request("http://localhost/api/webhooks/vapi", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: new Uint8Array(body),
    });
    const response = await handleVapiWebhook(request, recordInsteadOfRunning);
    return { status: response.status, logs };
  } finally {
    Object.assign(console, originals);
    allLogs.push(...logs);
  }
}

function sendSigned(body: Buffer, now = new Date()) {
  return send(body, signLikeVapi(body, settings, now));
}

async function storedCall(vapiCallId: string) {
  return db.select().from(calls).where(eq(calls.vapiCallId, vapiCallId));
}

export async function runVapiChecks(ownerA: TestUser, ownerB: TestUser) {
  const lineA = await createPhoneLine(ownerA.companyId, `pn-a-${runId}`);
  const lineB = await createPhoneLine(ownerB.companyId, `pn-b-${runId}`);
  const callA = `call-a-${runId}`;

  await check("a signed end-of-call-report is saved under the phone line's company", async () => {
    assert.equal((await sendSigned(reportBody(lineA.vapiPhoneNumberId, callA))).status, 200);
    const [row] = await storedCall(callA);
    assert.ok(row, "call not stored");
    // The payload claims another company (metadata.companyId, orgId): ignored.
    assert.equal(row.companyId, ownerA.companyId);
    const detail = await getCallForSession(sessionFor(ownerA), row.id);
    assert.equal(detail?.transcript, `User: ${secretPhrase}`);
    assert.equal(detail?.callerNumber, callerNumber);
  });

  await check("the transcript is encrypted at rest and the recording URL is not stored", async () => {
    const [row] = await storedCall(callA);
    assert.ok(row.transcriptEncrypted?.startsWith("v1:"));
    const wholeRow = JSON.stringify(row);
    assert.ok(!wholeRow.includes(secretPhrase), "transcript stored in plain text");
    assert.ok(!wholeRow.includes("secret-recording"), "recording URL stored");
  });

  await check("the same call delivered twice is saved once and analyzed once", async () => {
    assert.equal(scheduledAnalyses, 1, "the first delivery should schedule one analysis");
    assert.equal((await sendSigned(reportBody(lineA.vapiPhoneNumberId, callA))).status, 200);
    assert.equal((await storedCall(callA)).length, 1);
    assert.equal(scheduledAnalyses, 1, "a duplicate delivery scheduled another analysis");
  });

  await check("a call on company B's line belongs to B and is invisible to A", async () => {
    const callB = `call-b-${runId}`;
    assert.equal((await sendSigned(reportBody(lineB.vapiPhoneNumberId, callB))).status, 200);
    const [row] = await storedCall(callB);
    assert.equal(row.companyId, ownerB.companyId);
    const callsForA = await listCallsForSession(sessionFor(ownerA));
    assert.ok(!callsForA.some((call) => call.id === row.id));
    assert.equal(await getCallForSession(sessionFor(ownerA), row.id), null);
  });

  await check("unsigned, wrongly signed, tampered, stale and future requests get 401, save nothing, log one line", async () => {
    const body = () => reportBody(lineA.vapiPhoneNumberId, `call-rejected-${randomUUID()}`);
    const goodBody = body();
    const goodHeaders = signLikeVapi(goodBody, settings, new Date());
    const wrongSecretHeaders = signLikeVapi(goodBody, { ...settings, secret: "x".repeat(40) }, new Date());
    const tampered = Buffer.from(goodBody.toString("utf8").replace(secretPhrase, "changed-words"), "utf8");
    const attempts = [
      await send(body(), {}),
      await send(body(), { [settings.timestampHeader]: goodHeaders[settings.timestampHeader] }),
      await send(goodBody, wrongSecretHeaders),
      await send(tampered, goodHeaders),
      await sendSigned(body(), new Date(Date.now() - 10 * 60 * 1000)),
      await sendSigned(body(), new Date(Date.now() + 10 * 60 * 1000)),
    ];
    for (const attempt of attempts) {
      assert.equal(attempt.status, 401);
      assert.deepEqual(attempt.logs, ["Vapi webhook rejected: invalid signature"]);
    }
    const rejectedCalls = await db.select({ id: calls.id }).from(calls).where(eq(calls.phoneLineId, lineA.id));
    assert.equal(rejectedCalls.length, 1, "a rejected request was stored");
  });

  await check("a body over 1 MB gets 413", async () => {
    assert.equal((await sendSigned(Buffer.alloc(1024 * 1024 + 1, "a"))).status, 413);
  });

  await check("unknown lines and other events are acknowledged and nothing is saved", async () => {
    const unknownCall = `call-unknown-${runId}`;
    assert.equal((await sendSigned(reportBody(`pn-unknown-${runId}`, unknownCall))).status, 200);
    assert.equal((await storedCall(unknownCall)).length, 0);
    const statusUpdate = Buffer.from(JSON.stringify({ message: { type: "status-update" } }));
    assert.equal((await sendSigned(statusUpdate)).status, 200);
  });

  await check("a signed request with invalid JSON gets 400", async () => {
    assert.equal((await sendSigned(Buffer.from("{not json"))).status, 400);
  });

  await check("a database error logs only the error type, never call data", async () => {
    // Postgres refuses text containing a NUL character, so this insert fails.
    const result = await sendSigned(reportBody(lineA.vapiPhoneNumberId, `call-db-error-${runId}`, "bad\u0000reason"));
    assert.equal(result.status, 500);
    assert.equal(result.logs.length, 1);
    assert.match(result.logs[0], /^Vapi webhook failed: \w+$/);
  });

  await check("no transcript, phone number or recording URL ever reached the logs", async () => {
    assert.ok(allLogs.length > 0, "nothing was captured");
    for (const line of allLogs) {
      assert.ok(!line.includes(secretPhrase), `transcript in log: ${line.slice(0, 40)}`);
      assert.ok(!line.includes(callerNumber), "phone number in log");
      assert.ok(!line.includes("secret-recording"), "recording URL in log");
    }
  });

  await check("signature settings match an independently computed HMAC, and changed bytes fail", async () => {
    const body = Buffer.from('{"message":{"type":"status-update"}}');
    const now = new Date();
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const independent = createHmac("sha256", settings.secret).update(`${timestamp}.${body.toString()}`).digest("hex");
    const defaults = { ...settings, algorithm: "sha256" as const, payloadFormat: "{timestamp}.{body}" as const, encoding: "hex" as const, prefix: "", timestampUnit: "seconds" as const };
    assert.equal(isValidVapiSignature({ rawBody: body, signature: independent, timestamp, settings: defaults, now }), true);
    assert.equal(isValidVapiSignature({ rawBody: Buffer.from(body.toString() + " "), signature: independent, timestamp, settings: defaults, now }), false);

    const variant = { ...defaults, encoding: "base64" as const, prefix: "sha256=", timestampUnit: "milliseconds" as const };
    const headers = signLikeVapi(body, variant, now);
    const signature = headers[variant.signatureHeader];
    assert.ok(signature.startsWith("sha256="));
    assert.equal(isValidVapiSignature({ rawBody: body, signature, timestamp: headers[variant.timestampHeader], settings: variant, now }), true);
    assert.equal(isValidVapiSignature({ rawBody: body, signature: signature.slice(7), timestamp: headers[variant.timestampHeader], settings: variant, now }), false);
  });

  await check("a transcript encrypted for one company cannot be decrypted as another's", async () => {
    const encrypted = encryptText("hello", `call-transcript:${ownerA.companyId}:x`);
    assert.equal(decryptText(encrypted, `call-transcript:${ownerA.companyId}:x`), "hello");
    assert.throws(() => decryptText(encrypted, `call-transcript:${ownerB.companyId}:x`));
    const [version, iv, tag, data] = encrypted.split(":");
    const flipped = Buffer.from(data, "base64");
    flipped[0] = flipped[0] ^ 1;
    assert.throws(() => decryptText([version, iv, tag, flipped.toString("base64")].join(":"), `call-transcript:${ownerA.companyId}:x`));
    // The tag cut short (Node alone would accept 4, 8 or 12 of its 16 bytes): refused.
    for (const length of [4, 8, 12, 15]) {
      const shortTag = Buffer.from(tag, "base64").subarray(0, length).toString("base64");
      assert.throws(() => decryptText([version, iv, shortTag, data].join(":"), `call-transcript:${ownerA.companyId}:x`), `a ${length}-byte tag was accepted`);
    }
  });

  await check("vapi: the signature headers default to a Vapi HMAC credential's own, x-signature and x-timestamp", async () => {
    const minimal = { DATABASE_URL: "postgres://x@localhost/x", BETTER_AUTH_SECRET: "s".repeat(32), BETTER_AUTH_URL: "http://localhost:3000" };
    const defaults = parseEnv({ ...minimal, DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"), VAPI_WEBHOOK_SECRET: "v".repeat(32) });
    assert.deepEqual([defaults.VAPI_SIGNATURE_HEADER, defaults.VAPI_TIMESTAMP_HEADER], ["x-signature", "x-timestamp"]);
  });
}
