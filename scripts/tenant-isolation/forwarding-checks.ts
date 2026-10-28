// Forwarding address routing checks (step 24): only a company's forwarding
// address decides where a received email goes, wherever Resend lists it (to,
// cc, bcc, received_for); typed support addresses, our sending address,
// look-alikes and unknown tokens never do; an email naming two companies goes
// to neither; and odd recipient lists never get a 400 (Resend would retry them
// for days). Only fixed lines are logged, never an address.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createInboundAddress, getInboundTokenForCompany } from "@/db/inbound-emails";
import { getInboundEmailDomain } from "@/lib/forwarding-address";
import { getSendingAddress } from "@/lib/send-email";
import { check, runId, type TestUser } from "./helpers";
import { forwardingAddressOf, postReceivedEmail, storedInboundEmail, type RecipientFields } from "./resend-helpers";

const NO_FORWARDING_ADDRESS = "Inbound email ignored: no forwarding address";
const SEVERAL_COMPANIES = "Inbound email ignored: forwarding addresses of more than one company";

// Posts one signed email and says which company it was saved for (undefined = not saved).
async function companyThatGot(label: string, recipients: RecipientFields, expectedLog?: string): Promise<string | undefined> {
  const emailId = `fwd-${label}-${runId}`;
  const { result, logs } = await postReceivedEmail(emailId, recipients);
  assert.equal(result, 200, `${label}: status`);
  if (expectedLog) {
    assert.deepEqual(logs, [expectedLog], `${label}: logs`);
  }
  assert.ok(logs.every((line) => !line.includes("@")), `${label}: an address was logged`);
  return (await storedInboundEmail(emailId))?.companyId;
}

export async function runForwardingChecks(ownerA: TestUser, ownerB: TestUser) {
  const forwardingA = await forwardingAddressOf(ownerA);
  const forwardingB = await forwardingAddressOf(ownerB);
  const tokenA = (await getInboundTokenForCompany(ownerA.companyId)) ?? "";
  const domain = getInboundEmailDomain();

  await check("forwarding: mail to A's forwarding address reaches A, in to, cc, bcc or received_for", async () => {
    const elsewhere = [`someone-${runId}@customer.test`];
    const cases: [string, RecipientFields][] = [
      ["to", { to: [forwardingA], cc: elsewhere }],
      ["cc", { to: elsewhere, cc: [forwardingA] }],
      ["bcc", { to: elsewhere, bcc: [forwardingA] }],
      ["received-for", { to: elsewhere, received_for: [forwardingA] }],
      ["display-name", { to: [`"Acme Support" <${forwardingA.toUpperCase()}>`] }],
    ];
    for (const [label, recipients] of cases) {
      assert.equal(await companyThatGot(label, recipients), ownerA.companyId, label);
    }
  });

  await check("forwarding: typed support addresses and our sending address never decide the company", async () => {
    const typed = `help-${runId}@acme.test`;
    await createInboundAddress(ownerA.companyId, typed);
    await createInboundAddress(ownerB.companyId, typed);
    // A row like one saved before step 24, when owners could list our own address.
    await createInboundAddress(ownerB.companyId, getSendingAddress());
    const cases: [string, RecipientFields][] = [
      ["typed-to", { to: [typed] }],
      ["typed-everywhere", { to: [typed], cc: [typed], bcc: [typed], received_for: [typed] }],
      ["sending-address", { to: [getSendingAddress()], received_for: [getSendingAddress().toUpperCase()] }],
    ];
    for (const [label, recipients] of cases) {
      assert.equal(await companyThatGot(label, recipients, NO_FORWARDING_ADDRESS), undefined, label);
    }
  });

  await check("forwarding: look-alike and unknown forwarding addresses are ignored", async () => {
    const lookAlikes = [
      `c-${tokenA}@other-${runId}.test`,
      `c-${tokenA}@sub.${domain}`,
      `c-${tokenA}x@${domain}`,
      `x-c-${tokenA}@${domain}`,
      `c-${tokenA}+tag@${domain}`,
      `c-${tokenA.slice(0, 31)}@${domain}`,
      `${tokenA}@${domain}`,
      `c-${randomUUID().replaceAll("-", "")}@${domain}`,
    ];
    for (const [index, address] of lookAlikes.entries()) {
      assert.equal(await companyThatGot(`look-alike-${index}`, { to: [address] }, NO_FORWARDING_ADDRESS), undefined, address);
    }
  });

  await check("forwarding: an email naming two companies' forwarding addresses goes to neither", async () => {
    const cases: [string, RecipientFields][] = [
      ["both-to", { to: [forwardingA, forwardingB] }],
      ["to-and-received-for", { to: [forwardingA], received_for: [forwardingB] }],
      ["b-first", { cc: [forwardingB], bcc: [forwardingA] }],
    ];
    for (const [label, recipients] of cases) {
      assert.equal(await companyThatGot(label, recipients, SEVERAL_COMPANIES), undefined, label);
    }
    // An unknown token belongs to nobody, so A is still the only company named.
    const unknown = `c-${randomUUID().replaceAll("-", "")}@${domain}`;
    assert.equal(await companyThatGot("unknown-and-a", { to: [unknown, forwardingA] }), ownerA.companyId);
    assert.equal(await companyThatGot("b-only", { to: [forwardingB] }), ownerB.companyId);
  });

  await check("inbound: odd recipient lists still get 200, and the forwarding address in them still counts", async () => {
    const many = Array.from({ length: 51 }, (_, index) => `r${index}-${runId}@customer.test`);
    const cases: [string, RecipientFields, string | undefined][] = [
      ["51-recipients", { to: [forwardingA, ...many] }, ownerA.companyId],
      ["330-characters", { to: [`${"x".repeat(320)}@long.test`, forwardingA] }, ownerA.companyId],
      ["not-text", { to: [42, null, { address: forwardingB }, forwardingA] }, ownerA.companyId],
      ["single-string", { to: forwardingA }, ownerA.companyId],
      ["not-a-list", { to: { address: forwardingA }, cc: 7 }, undefined],
      ["beyond-50", { to: [...many, forwardingA] }, undefined],
    ];
    for (const [label, recipients, expected] of cases) {
      assert.equal(await companyThatGot(label, recipients), expected, label);
    }
  });
}
