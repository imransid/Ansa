// Forwarding address setup checks (step 24): every company gets its own random
// forwarding address that no input can set; the database refuses a malformed
// or shared token; replacing one company's address (operator script) retires
// the old one and touches no other company; replies to customer emails come
// back through it when the company has no reply-to; Setup shows when the last
// email arrived (for the company's own email only) and a stuck one as stuck;
// and INBOUND_EMAIL_DOMAIN is checked at startup.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { getInboundTokenForCompany, replaceInboundTokenForCompany } from "@/db/inbound-emails";
import { companies, inboundEmails } from "@/db/schema";
import { parseEnv } from "@/lib/env";
import { getInboundEmailDomain } from "@/lib/forwarding-address";
import { findProductionSettingProblems } from "@/lib/production-warnings";
import { getLatestCustomerEmailForSession } from "@/services/customer-emails";
import { processInboundEmail } from "@/services/inbound-email-processing";
import { addInboundAddressForSession, getSetupForSession, setCompanyNameForSession, setReplyToEmailForSession } from "@/services/setup";
import { markTicketSolvedForSession } from "@/services/ticket-status";
import { createTicketForCompany } from "@/services/tickets";
import { answer } from "./brain-guard-checks";
import { fakeModel } from "./brain-test-calls";
import { assertRefusedByConstraint, check, devOutboxPath, runId, sessionFor, signUpTestOwner, type TestUser } from "./helpers";
import { forwardingAddressOf, postReceivedEmail, storedInboundEmail } from "./resend-helpers";

const tokenOf = async (user: TestUser) => (await getInboundTokenForCompany(user.companyId)) ?? "";

export async function runForwardingSetupChecks(ownerA: TestUser, ownerB: TestUser) {
  const owner = sessionFor(ownerA);

  await check("forwarding: each company has its own random forwarding address, and no input sets or changes it", async () => {
    const tokenA = await tokenOf(ownerA);
    assert.match(tokenA, /^[0-9a-f]{32}$/);
    assert.notEqual(tokenA, await tokenOf(ownerB));
    assert.equal((await getSetupForSession(owner)).forwardingAddress, `c-${tokenA}@${getInboundEmailDomain()}`);
    const smuggled = { inboundToken: "0".repeat(32), forwardingAddress: await forwardingAddressOf(ownerB) };
    await setCompanyNameForSession(owner, { companyName: `Isolation test a ${runId}`, ...smuggled });
    await setReplyToEmailForSession(owner, { replyToEmail: "", ...smuggled });
    assert.equal((await addInboundAddressForSession(owner, { address: smuggled.forwardingAddress })).ok, false);
    assert.equal(await tokenOf(ownerA), tokenA);
    assert.ok(!(await getSetupForSession(owner)).inboundAddresses.includes(smuggled.forwardingAddress));
  });

  await check("forwarding: the database refuses a malformed or shared token", async () => {
    const setToken = (user: TestUser, inboundToken: string) => db.update(companies).set({ inboundToken }).where(eq(companies.id, user.companyId));
    for (const bad of ["support", "0".repeat(31), "G".repeat(32), `${"a".repeat(32)} `]) {
      await assertRefusedByConstraint(setToken(ownerB, bad), "companies_inbound_token_format");
    }
    await assertRefusedByConstraint(setToken(ownerB, await tokenOf(ownerA)), "companies_inbound_token_unique");
  });

  await check("forwarding: replacing A's address (operator script) gives A a new random one; the old one stops routing, B keeps its own", async () => {
    const oldAddressOfA = await forwardingAddressOf(ownerA);
    const tokenOfB = await tokenOf(ownerB);
    const newToken = await replaceInboundTokenForCompany(ownerA.companyId);
    assert.match(newToken ?? "", /^[0-9a-f]{32}$/);
    assert.equal(await tokenOf(ownerA), newToken);
    assert.equal(await tokenOf(ownerB), tokenOfB);
    const newAddressOfA = await forwardingAddressOf(ownerA);
    assert.notEqual(newAddressOfA, oldAddressOfA);
    assert.equal((await getSetupForSession(owner)).forwardingAddress, newAddressOfA);
    await postReceivedEmail(`fwd-old-address-${runId}`, { to: [oldAddressOfA] });
    assert.equal(await storedInboundEmail(`fwd-old-address-${runId}`), undefined, "mail to the old address was taken");
    await postReceivedEmail(`fwd-new-address-${runId}`, { to: [newAddressOfA] });
    assert.equal((await storedInboundEmail(`fwd-new-address-${runId}`))?.companyId, ownerA.companyId);
  });

  await check("forwarding: without a reply-to of its own, a solved email's Reply-To is the company's forwarding address", async () => {
    const sessionB = sessionFor(ownerB);
    assert.equal((await setReplyToEmailForSession(sessionB, { replyToEmail: "" })).ok, true);
    const customerEmail = `reply-${runId}@example.test`;
    const ticket = await createTicketForCompany(ownerB.companyId, { subject: "Reply-To check", description: "x", channel: "email", customerEmail });
    assert.equal((await markTicketSolvedForSession(sessionB, { ticketId: ticket.id, confirmedCustomerEmail: customerEmail })).ok, true);
    const sent = await getLatestCustomerEmailForSession(sessionB, ticket.id);
    const file = await readFile(devOutboxPath(sent?.providerMessageId ?? ""), "utf8");
    assert.ok(file.includes(`<strong>Reply-To:</strong> ${await forwardingAddressOf(ownerB)}`), "the Reply-To is not B's forwarding address");
  });

  await check("forwarding: Setup shows when the company's last email arrived and what became of it, a stuck one as stuck", async () => {
    const ownerC = await signUpTestOwner("forwarding-c");
    const sessionC = sessionFor(ownerC);
    assert.equal((await getSetupForSession(sessionC)).lastInboundEmail, null);
    const emailId = `fwd-last-${runId}`;
    await postReceivedEmail(emailId, { to: [await forwardingAddressOf(ownerC)] });
    const received = (await getSetupForSession(sessionC)).lastInboundEmail;
    assert.deepEqual([received?.status, received?.ticketNumber, received?.stuck], ["received", null, false]);
    // Its run cut off 20 minutes ago: stuck, by the Emails page's own rule.
    const cutOff = new Date(Date.now() - 20 * 60 * 1000);
    await db.update(inboundEmails).set({ status: "processing", processingStartedAt: cutOff }).where(eq(inboundEmails.id, (await storedInboundEmail(emailId)).id));
    assert.equal((await getSetupForSession(sessionC)).lastInboundEmail?.stuck, true);
    const fakeEmail = { from: `Kim <kim-${runId}@customer.test>`, to: [], subject: "Hello", text: "Where is my parcel?", headers: {}, authentication: null };
    const outcome = await processInboundEmail(ownerC.companyId, (await storedInboundEmail(emailId)).id, { fetchEmail: async () => fakeEmail, askModel: fakeModel(answer({})).ask });
    assert.equal(outcome, "ticketed");
    const ticketed = (await getSetupForSession(sessionC)).lastInboundEmail;
    assert.deepEqual([ticketed?.ticketNumber, ticketed?.stuck], [1, false]);
    // A's newest email arrived before C's, so A's Setup can't be showing C's.
    const lastOfA = (await getSetupForSession(owner)).lastInboundEmail;
    assert.ok(lastOfA && ticketed && lastOfA.receivedAt.getTime() < ticketed.receivedAt.getTime());
  });

  await check("env: INBOUND_EMAIL_DOMAIN is a bare domain, required with real email; production warns when it is missing or EMAIL_FROM's domain", async () => {
    const base = {
      DATABASE_URL: "postgres://x@localhost/x",
      BETTER_AUTH_SECRET: "s".repeat(32),
      BETTER_AUTH_URL: "http://localhost:3000",
      DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
      VAPI_WEBHOOK_SECRET: "v".repeat(32),
    };
    assert.equal(parseEnv(base).INBOUND_EMAIL_DOMAIN, undefined);
    assert.equal(parseEnv({ ...base, INBOUND_EMAIL_DOMAIN: " Inbound.Example.COM " }).INBOUND_EMAIL_DOMAIN, "inbound.example.com");
    for (const bad of ["c@inbound.example.com", "https://inbound.example.com", "inbound", "inbound.example.com/x", ""]) {
      assert.throws(() => parseEnv({ ...base, INBOUND_EMAIL_DOMAIN: bad }), /INBOUND_EMAIL_DOMAIN/, bad);
    }
    // Real emails use the forwarding address as Reply-To: on the dev domain every reply would bounce.
    const realEmail = { ...base, SEND_REAL_EMAIL: "true", RESEND_API_KEY: "re_x", EMAIL_FROM: "support@example.com" };
    assert.throws(() => parseEnv(realEmail), /INBOUND_EMAIL_DOMAIN is required when SEND_REAL_EMAIL=true/);
    assert.equal(parseEnv({ ...realEmail, INBOUND_EMAIL_DOMAIN: "inbound.example.com" }).INBOUND_EMAIL_DOMAIN, "inbound.example.com");
    const problemsWith = (extra: Record<string, string>) => findProductionSettingProblems(parseEnv({ ...base, ...extra })).join("\n");
    assert.match(problemsWith({}), /INBOUND_EMAIL_DOMAIN is missing/);
    assert.match(problemsWith({ INBOUND_EMAIL_DOMAIN: "example.com", EMAIL_FROM: "Support@Example.com" }), /INBOUND_EMAIL_DOMAIN is EMAIL_FROM's domain/);
    assert.doesNotMatch(problemsWith({ INBOUND_EMAIL_DOMAIN: "inbound.example.com", EMAIL_FROM: "support@example.com" }), /INBOUND_EMAIL_DOMAIN/);
  });
}
