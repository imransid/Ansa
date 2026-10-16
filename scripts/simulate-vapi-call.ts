// Sends a made-up, signed Vapi end-of-call-report to the running app, signed
// exactly the way lib/env.ts says Vapi signs. Also sends bad requests to show
// they are refused.
//
// Run with: pnpm simulate:vapi-call <vapiPhoneNumberId> [variant]
// Variants: valid (default), all, duplicate, unsigned, bad-signature, stale,
// too-large, unknown-line, other-event.
// Needs `pnpm dev` running and the number linked with pnpm link:phone-line.

import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { getVapiSignatureSettings, signLikeVapi } from "@/lib/vapi-signature";
import { buildSampleEndOfCallReport, SAMPLE_TRANSCRIPT } from "./vapi-sample";

const WEBHOOK_URL = `${env.BETTER_AUTH_URL}/api/webhooks/vapi`;
const settings = getVapiSignatureSettings();

type Variant = { name: string; expectedStatus: number; send: (phoneNumberId: string) => Promise<number> };

function reportBody(phoneNumberId: string, callId = `sim-${randomUUID()}`): Buffer {
  const report = buildSampleEndOfCallReport({ callId, phoneNumberId, callerNumber: "+1 555 0142", transcript: SAMPLE_TRANSCRIPT });
  return Buffer.from(JSON.stringify(report), "utf8");
}

async function post(body: Buffer, headers: Record<string, string>): Promise<number> {
  const response = await fetch(WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: new Uint8Array(body) });
  return response.status;
}

function signed(body: Buffer, now = new Date()): Promise<number> {
  return post(body, signLikeVapi(body, settings, now));
}

const VARIANTS: Variant[] = [
  { name: "valid", expectedStatus: 200, send: (line) => signed(reportBody(line)) },
  {
    name: "duplicate",
    expectedStatus: 200,
    send: async (line) => {
      const body = reportBody(line);
      await signed(body);
      return signed(body); // same call id again: accepted, saved only once
    },
  },
  { name: "unsigned", expectedStatus: 401, send: (line) => post(reportBody(line), {}) },
  {
    name: "bad-signature",
    expectedStatus: 401,
    send: (line) => {
      const headers = signLikeVapi(reportBody(line), settings, new Date());
      return post(reportBody(line), headers); // signature is for a different body
    },
  },
  { name: "stale", expectedStatus: 401, send: (line) => signed(reportBody(line), new Date(Date.now() - 10 * 60 * 1000)) },
  { name: "too-large", expectedStatus: 413, send: () => signed(Buffer.alloc(1024 * 1024 + 1, "a")) },
  { name: "unknown-line", expectedStatus: 200, send: () => signed(reportBody(`unknown-${randomUUID()}`)) },
  {
    name: "other-event",
    expectedStatus: 200,
    send: () => signed(Buffer.from(JSON.stringify({ message: { type: "status-update", status: "in-progress" } }))),
  },
];

async function main() {
  const phoneNumberId = process.argv[2];
  const variantName = process.argv[3] ?? "valid";
  if (!phoneNumberId) {
    console.error("Usage: pnpm simulate:vapi-call <vapiPhoneNumberId> [variant|all]");
    process.exitCode = 1;
    return;
  }

  const toRun = variantName === "all" ? VARIANTS : VARIANTS.filter((variant) => variant.name === variantName);
  if (toRun.length === 0) {
    console.error(`Unknown variant "${variantName}". Use one of: all, ${VARIANTS.map((v) => v.name).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  for (const variant of toRun) {
    const status = await variant.send(phoneNumberId);
    const verdict = status === variant.expectedStatus ? "OK  " : "FAIL";
    console.log(`${verdict} ${variant.name.padEnd(14)} got ${status}, expected ${variant.expectedStatus}`);
    if (status !== variant.expectedStatus) {
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error("Simulation failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
