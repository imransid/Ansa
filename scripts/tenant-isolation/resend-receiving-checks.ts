// Step 27, fetching a received email's content from Resend: temporary errors
// (429, 5xx, no answer) are tried 3 times with waits; every try has a time
// limit, so a request that never answers is cut off and tried again (checked
// with the real SDK against a local server that never answers: nothing here
// reaches Resend); and a failure writes one fixed log line with Resend's
// error code and HTTP status, never its message. Sending has a time limit
// too: a send that never answers is a failed delivery ("timeout").

import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Resend } from "resend";
import { isTemporaryResendError, RECEIVING_TIMING, requestReceivedEmail, requestSend } from "@/adapters/resend";
import { retryWhileTemporary } from "@/lib/retry";
import { captureConsole, check, runId } from "./helpers";

// Our own log lines only: in development the SDK also prints its errors.
function ownLogLines(logs: string[]): string[] {
  return logs.filter((line) => line.startsWith("Resend receiving fetch failed"));
}

export async function runResendReceivingChecks() {
  await check("resend receiving: temporary errors (429, 5xx, no answer) are tried 3 times with waits, others once", async () => {
    assert.deepEqual([429, 500, 503, null].map((statusCode) => isTemporaryResendError({ statusCode })), [true, true, true, true]);
    assert.deepEqual([400, 401, 404, 422].map((statusCode) => isTemporaryResendError({ statusCode })), [false, false, false, false]);
    assert.equal(isTemporaryResendError(null), false);
    const waits: number[] = [];
    const sleep = async (milliseconds: number) => {
      waits.push(milliseconds);
    };
    let attempts = 0;
    const busy = async () => {
      attempts += 1;
      return { statusCode: 429 };
    };
    await retryWhileTemporary(busy, isTemporaryResendError, [1_000, 4_000], sleep);
    assert.deepEqual([attempts, waits], [3, [1_000, 4_000]]);
    attempts = 0;
    const secondTryWorks = async () => {
      attempts += 1;
      return attempts === 2 ? null : { statusCode: 502 };
    };
    assert.equal(await retryWhileTemporary(secondTryWorks, isTemporaryResendError, [1_000, 4_000], sleep), null);
    assert.equal(attempts, 2);
    attempts = 0;
    const notFound = async () => {
      attempts += 1;
      return { statusCode: 404 };
    };
    await retryWhileTemporary(notFound, isTemporaryResendError, [1_000, 4_000], sleep);
    assert.equal(attempts, 1, "a 404 was tried again");
  });

  await check("resend receiving: a request that never answers is cut off, tried again, then logged (real SDK, local server)", async () => {
    let requests = 0;
    const silentServer = createServer(() => {
      requests += 1;
    });
    await new Promise<void>((resolve) => silentServer.listen(0, "127.0.0.1", resolve));
    try {
      const baseUrl = `http://127.0.0.1:${(silentServer.address() as AddressInfo).port}`;
      const resend = new Resend("re_checks_only", { baseUrl });
      const request = (signal: AbortSignal) => resend.emails.receiving.get("email-id", { html_format: "cid" }, { signal });
      // WHY 2 seconds a try, not less: on a busy machine the SDK can take
      // half a second to get a request to the server at all (measured: 16 to
      // 489 ms), so 50 ms sometimes cut a try off before the server saw it,
      // and it counted 2 tries instead of 3.
      const { result, logs } = await captureConsole(() => requestReceivedEmail(request, { timeoutMs: 2_000, retryDelaysMs: [1, 1] }));
      assert.deepEqual([result, requests], [null, 3]);
      assert.deepEqual(ownLogLines(logs), ["Resend receiving fetch failed: application_error no-status"]);
    } finally {
      silentServer.closeAllConnections();
      silentServer.close();
    }
    // The real limits leave 3 tries far inside the 300 seconds a run may take.
    const worstCaseMs = RECEIVING_TIMING.timeoutMs * 3 + RECEIVING_TIMING.retryDelaysMs.reduce((sum, delay) => sum + delay, 0);
    assert.ok(worstCaseMs <= 90_000, `${worstCaseMs} ms`);
  });

  await check("resend receiving: a key without receiving access logs Resend's code and status only, never its message, and is tried once", async () => {
    let tries = 0;
    const refused = async () => {
      tries += 1;
      return { data: null, error: { name: "restricted_api_key", statusCode: 401, message: "This key can only send to secret@customer.test" } };
    };
    const { result, logs } = await captureConsole(() => requestReceivedEmail(refused, { timeoutMs: 1_000, retryDelaysMs: [1, 1] }));
    assert.deepEqual([result, tries, logs], [null, 1, ["Resend receiving fetch failed: restricted_api_key 401"]]);
    const found = await requestReceivedEmail(async () => ({ data: { from: "a@b.test" }, error: null }));
    assert.deepEqual(found, { from: "a@b.test" });
  });

  await check("resend sending: a send that never answers is cut off as a failed delivery, 'timeout', sent with its idempotency key (real SDK, local server)", async () => {
    const idempotencyKeys: unknown[] = [];
    const silentServer = createServer((request) => {
      idempotencyKeys.push(request.headers["idempotency-key"]);
    });
    await new Promise<void>((resolve) => silentServer.listen(0, "127.0.0.1", resolve));
    try {
      const resend = new Resend("re_checks_only", { baseUrl: `http://127.0.0.1:${(silentServer.address() as AddressInfo).port}` });
      const payload = { from: "a@example.test", to: "b@example.test", subject: "Solved", text: "Solved" };
      const startedAt = Date.now();
      // 3 seconds for the same reason as above: 200 ms was sometimes over
      // before the request reached the server. Still far below Node's own
      // 5-minute default, which is what this proves the limit replaces.
      const { result } = await captureConsole(() => requestSend((signal) => resend.emails.send(payload, { idempotencyKey: `key-${runId}`, signal }), 3_000));
      assert.deepEqual(result, { ok: false, error: "timeout" });
      assert.ok(Date.now() - startedAt < 10_000, "the send was not cut off");
      assert.deepEqual(idempotencyKeys, [`key-${runId}`]);
    } finally {
      silentServer.closeAllConnections();
      silentServer.close();
    }
    // In time: Resend's code for a refusal (never its message), its id for an email it took.
    assert.deepEqual(await requestSend(async () => ({ data: null, error: { name: "validation_error", message: "secret@customer.test" } })), { ok: false, error: "validation_error" });
    assert.deepEqual(await requestSend(async () => ({ data: { id: `re-${runId}` }, error: null })), { ok: true, providerMessageId: `re-${runId}` });
  });
}
