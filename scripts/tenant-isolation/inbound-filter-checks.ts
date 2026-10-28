// Step 27, which received emails are skipped: newsletters and automatic
// replies are recognised by more headers (List-Id, List-Unsubscribe,
// X-Autoreply, X-Autorespond, Precedence: auto_reply, an empty Return-Path),
// but not mail through the company's own Google Group, not even when the
// group put its own address in From (DMARC); a contact form's Reply-To is the
// flood key and only a suggestion; and over the company's hourly cap the email
// still becomes a ticket, without asking Claude. FAKE fetcher and model only.

import assert from "node:assert/strict";
import { createInboundAddress } from "@/db/inbound-emails";
import { getOriginalEmailForSession } from "@/services/inbound-emails";
import { isOverRateLimit, RATE_LIMITS } from "@/services/rate-limit";
import { answer } from "./brain-guard-checks";
import { fakeModel } from "./brain-test-calls";
import { check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { receiveAndProcess, resendContent, senderFor } from "./inbound-helpers";

export async function runInboundFilterChecks() {
  const owner = await signUpTestOwner("filters");

  await check("inbound filters: List-Id, List-Unsubscribe, X-Autoreply, X-Autorespond, Precedence auto_reply and an empty Return-Path are skipped, sender kept", async () => {
    const cases: [string, Record<string, string>, string][] = [
      ["list-id", { "List-Id": "<news.shop.example>" }, "bulk"],
      ["unsubscribe", { "list-unsubscribe": "<https://shop.example/u>" }, "bulk"],
      ["x-autoreply", { "X-Autoreply": "yes" }, "auto_reply"],
      ["x-autorespond", { "X-Autorespond": "true" }, "auto_reply"],
      ["precedence", { Precedence: "auto_reply" }, "auto_reply"],
      ["return-path", { "Return-Path": "<>" }, "auto_reply"],
    ];
    for (const [label, headers, reason] of cases) {
      const { outcome, row } = await receiveAndProcess(owner, `filter-${label}`, resendContent(`filter-${label}`, { headers }));
      assert.deepEqual([outcome, row.ignoredReason, row.ticketId], ["ignored", reason, null], label);
      assert.equal(row.fromAddress, senderFor(`filter-${label}`), `${label}: the Emails page can't say who sent it`);
    }
  });

  await check("inbound filters: mail through the company's own Google Group is not taken for bulk mail; X-Autoreply: no is no auto-reply", async () => {
    await createInboundAddress(owner.companyId, `help-${runId}@acme.test`);
    const groupHeaders = { "List-Id": `"Help" <help-${runId}.acme.test>`, Precedence: "list", "List-Unsubscribe": "<mailto:x@acme.test>" };
    const group = await receiveAndProcess(owner, "own-group", resendContent("own-group", { headers: groupHeaders }));
    assert.equal(group.outcome, "ticketed", "an email through the company's own Google Group was skipped as bulk mail");
    const notAuto = await receiveAndProcess(owner, "not-auto", resendContent("not-auto", { headers: { "X-Autoreply": "no" } }));
    assert.equal(notAuto.outcome, "ticketed");
  });

  await check("inbound filters: a customer's email the company's own Google Group sent under its own address (DMARC) becomes a ticket, the author only suggested", async () => {
    const group = `team-${runId}@acme.test`;
    await createInboundAddress(owner.companyId, group);
    const author = `ana-${runId}@yahoo.example`;
    // What Google Groups sends when the author's domain has DMARC p=reject.
    const rewritten = (label: string, replyTo: string[]) =>
      resendContent(label, { from: group, headers: { from: `'Ana' via Team <${group}>`, "List-Id": `<team-${runId}.acme.test>`, Precedence: "list" }, reply_to: replyTo });
    const viaGroup = await receiveAndProcess(owner, "group-dmarc", rewritten("group-dmarc", [`Ana <${author}>`]));
    assert.deepEqual([viaGroup.outcome, viaGroup.row.senderVerified, viaGroup.ticket?.customerEmail, viaGroup.row.replyToAddress], ["ticketed", true, null, author]);
    // Without one Reply-To naming the author it stays skipped, for "Make a ticket anyway".
    const noAuthor = await receiveAndProcess(owner, "group-no-author", rewritten("group-no-author", []));
    assert.deepEqual([noAuthor.outcome, noAuthor.row.ignoredReason], ["ignored", "support_address"]);
    // A group set to "reply to the group" names itself in Reply-To: never the customer.
    const customer = senderFor("group-reply-to-group");
    const viaReplyToGroup = resendContent("group-reply-to-group", { headers: { from: `Kim Lee <${customer}>`, "List-Id": `<team-${runId}.acme.test>` }, reply_to: [group] });
    const replyToGroup = await receiveAndProcess(owner, "group-reply-to-group", viaReplyToGroup);
    assert.deepEqual([replyToGroup.outcome, replyToGroup.ticket?.customerEmail, replyToGroup.row.replyToAddress], ["ticketed", customer, null]);
  });

  await check("inbound contact forms: one Reply-To is the flood key and only a suggestion: neither address is filled in", async () => {
    const relay = `noreply-${runId}@forms.example`;
    const fromForm = (label: string, customer: string) =>
      resendContent(label, { from: relay, headers: { from: `Website form <${relay}>` }, reply_to: [`Customer <${customer}>`] });
    const first = await receiveAndProcess(owner, "form-1", fromForm("form-1", `ana-${runId}@example.test`));
    assert.deepEqual([first.outcome, first.ticket?.customerEmail, first.row.replyToAddress], ["ticketed", null, `ana-${runId}@example.test`]);
    const original = await getOriginalEmailForSession(sessionFor(owner), first.ticket!.id);
    assert.deepEqual([original?.fromAddress, original?.replyToAddress], [relay, `ana-${runId}@example.test`]);
    // Eleven customers through the same relay in one hour all get tickets...
    for (let index = 0; index < 11; index++) {
      const { outcome } = await receiveAndProcess(owner, `form-many-${index}`, fromForm(`form-many-${index}`, `customer-${index}-${runId}@example.test`));
      assert.equal(outcome, "ticketed", `submission ${index + 1}`);
    }
    // ...while one customer sending eleven is still a flood.
    const outcomes: string[] = [];
    for (let index = 0; index < 11; index++) {
      outcomes.push((await receiveAndProcess(owner, `form-flood-${index}`, fromForm(`form-flood-${index}`, `flood-${runId}@example.test`))).outcome);
    }
    assert.deepEqual([outcomes.filter((outcome) => outcome === "ticketed").length, outcomes.at(-1)], [10, "ignored"]);
  });

  await check("inbound triage: over the company's hourly cap Claude is not asked (no category), the email still becomes a ticket that says why", async () => {
    const busy = await signUpTestOwner("triage-cap");
    for (let index = 0; index < RATE_LIMITS.emailTriagesPerCompany.maxAttempts; index++) {
      await isOverRateLimit("email-triage", busy.companyId, RATE_LIMITS.emailTriagesPerCompany);
    }
    const model = fakeModel(answer({ customer_issue: "x", ticket_subject: "x", category: "" }));
    const { outcome, ticket, logs } = await receiveAndProcess(busy, "over-cap", resendContent("over-cap", { subject: "Busy day" }), model.ask);
    assert.deepEqual([outcome, model.calls, ticket?.subject, ticket?.category], ["ticketed", 0, "Busy day", null]);
    assert.match(ticket?.description ?? "", /No AI summary or category: more than 100 emails reached your company this hour/);
    assert.ok(logs.includes("Email triage skipped: company hourly limit reached"), logs.join("\n"));
  });
}
