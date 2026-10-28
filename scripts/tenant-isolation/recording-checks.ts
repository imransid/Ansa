// Recording checks (step 14): recordings are only fetched from allowed https
// hosts (every redirect too), are copied into private storage under their
// company, can only be played by that company, and their links are never
// logged. Uses a FAKE downloader: no real network calls.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { createPhoneLine } from "@/db/phone-lines";
import { calls } from "@/db/schema";
import { isAllowedRecordingUrl, type Fetcher } from "@/lib/recording-download";
import { getVapiSignatureSettings, signLikeVapi } from "@/lib/vapi-signature";
import { getRecordingForSession, storeCallRecording } from "@/services/call-recordings";
import { handleVapiWebhook } from "@/services/vapi-webhook";
import { buildSampleEndOfCallReport } from "../vapi-sample";
import { saveTestCall } from "./brain-test-calls";
import { assertRefusedByConstraint, captureConsole, check, runId, sessionFor, type TestUser } from "./helpers";

const ALLOWED = "https://storage.vapi.ai/recordings/test.mp3";
const AUDIO = Buffer.from("ID3 fake mp3 bytes");

// A downloader that answers from a script of responses and records what it was asked.
function fakeFetcher(responses: Response[]) {
  const asked: string[] = [];
  const fetcher: Fetcher = async (url) => {
    asked.push(url);
    return responses.shift() ?? new Response(null, { status: 500 });
  };
  return { fetcher, asked };
}

const audio = () => new Response(AUDIO, { headers: { "content-type": "audio/mpeg" } });
const redirectTo = (location: string) => new Response(null, { status: 302, headers: { location } });

export async function runRecordingChecks(ownerA: TestUser, ownerB: TestUser) {
  const line = await createPhoneLine(ownerA.companyId, `pn-recording-${runId}`);
  const newCall = () => saveTestCall(line.vapiPhoneNumberId, "User: hello");
  const status = async (callId: string) => (await db.select().from(calls).where(eq(calls.id, callId)))[0];

  await check("recordings: only https URLs on an allowed host, without credentials, may be fetched", async () => {
    const hosts = ["storage.vapi.ai"];
    assert.equal(isAllowedRecordingUrl(ALLOWED, hosts), true);
    for (const bad of [
      "http://storage.vapi.ai/a.mp3",
      "https://evil.test/a.mp3",
      "https://storage.vapi.ai.evil.test/a.mp3",
      "https://user:pass@storage.vapi.ai/a.mp3",
      "https://storage.vapi.ai:8443/a.mp3",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/a.mp3",
      "file:///etc/passwd",
      "not a url",
    ]) {
      assert.equal(isAllowedRecordingUrl(bad, hosts), false, `allowed ${bad}`);
    }
  });

  await check("recordings: a recording is copied under its company and only that company can play it", async () => {
    const callId = await newCall();
    const { fetcher } = fakeFetcher([audio()]);
    const { result, logs } = await captureConsole(() => storeCallRecording(ownerA.companyId, callId, ALLOWED, { fetcher }));
    assert.equal(result, "stored");
    assert.ok(logs.every((line) => !line.includes("storage.vapi.ai")), "the recording URL was logged");
    const stored = await status(callId);
    assert.equal(stored.recordingStatus, "stored");
    assert.ok(stored.recordingKey?.startsWith(`recordings/${ownerA.companyId}/`));
    const forA = await getRecordingForSession(sessionFor(ownerA), callId);
    assert.ok(forA !== "rate-limited" && forA?.kind === "bytes" && forA.bytes.equals(AUDIO));
    assert.equal(await getRecordingForSession(sessionFor(ownerB), callId), null, "company B can play A's recording");
    assert.equal(await getRecordingForSession(sessionFor(ownerA), "not-a-uuid"), null);
  });

  await check("recordings: redirects are followed only to allowed hosts, and a bad one is never requested", async () => {
    const goodRedirect = fakeFetcher([redirectTo("https://storage.vapi.ai/final.mp3"), audio()]);
    assert.equal(await storeCallRecording(ownerA.companyId, await newCall(), ALLOWED, { fetcher: goodRedirect.fetcher }), "stored");
    const badRedirect = fakeFetcher([redirectTo("https://169.254.169.254/secret"), audio()]);
    const badCall = await newCall();
    assert.equal(await storeCallRecording(ownerA.companyId, badCall, ALLOWED, { fetcher: badRedirect.fetcher }), "failed");
    assert.deepEqual(badRedirect.asked, [ALLOWED], "the forbidden redirect target was requested");
    assert.equal((await status(badCall)).recordingStatus, "failed");
  });

  await check("recordings: non-audio, too-large and failing downloads are refused and nothing is stored", async () => {
    const cases: [Response, number][] = [
      [new Response("<html>", { headers: { "content-type": "text/html" } }), 1_000],
      [new Response(Buffer.alloc(2_000, 1), { headers: { "content-type": "audio/mpeg" } }), 1_000],
      [new Response(null, { status: 404 }), 1_000],
    ];
    for (const [response, maxBytes] of cases) {
      const callId = await newCall();
      const { fetcher } = fakeFetcher([response]);
      assert.equal(await storeCallRecording(ownerA.companyId, callId, ALLOWED, { fetcher, maxBytes }), "failed");
      const stored = await status(callId);
      assert.equal(stored.recordingKey, null);
    }
  });

  await check("recordings: the webhook schedules a copy only for an allowed host", async () => {
    const scheduled: string[] = [];
    for (const [label, url] of [["allowed", ALLOWED], ["not allowed", "https://evil.test/a.mp3"]]) {
      const report = buildSampleEndOfCallReport({ callId: `rec-${label}-${runId}`, phoneNumberId: line.vapiPhoneNumberId, callerNumber: "+1 555 0100", transcript: "User: hi" });
      report.message.artifact.recordingUrl = url;
      const body = Buffer.from(JSON.stringify(report));
      const before = scheduled.length;
      const request = new Request("http://localhost/api/webhooks/vapi", {
        method: "POST",
        headers: { "content-type": "application/json", ...signLikeVapi(body, getVapiSignatureSettings(), new Date()) },
        body: new Uint8Array(body),
      });
      // Tasks are recorded, never run (running analysis would call the paid API).
      const { logs } = await captureConsole(() => handleVapiWebhook(request, () => { scheduled.push(label); }));
      assert.equal(scheduled.length - before, label === "allowed" ? 2 : 1, `${label}: analysis + copy expected only when allowed`);
      assert.ok(logs.every((logLine) => !logLine.includes(url)), "the recording URL was logged");
    }
  });

  await check("recordings: the database refuses 'stored' without a file key", async () => {
    const callId = await newCall();
    await assertRefusedByConstraint(
      db.update(calls).set({ recordingStatus: "stored" }).where(eq(calls.id, callId)),
      "calls_recording_fields_match_status",
    );
  });
}
