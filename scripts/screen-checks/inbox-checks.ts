// Home and Inbox checks (the fixes of 2026-11-03), on the code itself, as
// ui-polish-checks.ts does: the pages that wait for customers ask the
// server again while in view and keep what is typed; a conversation's open
// request says what it is about, with its related knowledge; an email
// entry links the request it became; ansa's wait for your reply shows its
// time; and "Try your assistant" shows the question it answers.

import assert from "node:assert/strict";
import { describeEndedReason } from "@/lib/call-ended-reason";
import { HANDOVER_REASON_TEXT, handoverReasonText } from "@/lib/assistant/reasons";
import { contactLabel } from "@/lib/inbox";
import { check } from "./check";
import { attributeValue, openingTags, read, withoutComments } from "./source-helpers";

const CONVERSATION = "app/inbox/[conversationId]";

export async function runInboxChecks() {
  await check("Inbox: a customer without a name is never shown by a platform's raw id: on a chat channel they are '<app> customer'; an email address and a phone number stay as written", async () => {
    assert.equal(contactLabel({ displayName: null, externalId: "102290129340398:US.13491208655302741918", channel: "whatsapp" }), "WhatsApp customer");
    assert.equal(contactLabel({ displayName: null, externalId: "dev:stand-in:4242", channel: "messenger" }), "Messenger customer");
    assert.equal(contactLabel({ displayName: null, externalId: "5550001", channel: "telegram" }), "Telegram customer");
    assert.equal(contactLabel({ displayName: null, externalId: "unverified:ana@example.test", channel: "email" }), "ana@example.test");
    assert.equal(contactLabel({ displayName: null, externalId: "393331234567", channel: "phone" }), "393331234567");
    assert.equal(contactLabel({ displayName: "Lena Moretti", externalId: "5550001", channel: "telegram" }), "Lena Moretti");
    // Home's lines pass no id: an unnamed caller or sender stays "", for their own fallback.
    assert.equal(contactLabel({ displayName: null, externalId: "", channel: "phone" }), "");
  });

  await check("live pages: Home, the Inbox and a conversation ask the server again every 5 seconds while in view (Orders every 20), and the reply box and the open request's note keep what is typed through it", async () => {
    for (const file of ["app/dashboard/page.tsx", "app/inbox/page.tsx", `${CONVERSATION}/page.tsx`]) {
      assert.match(withoutComments(await read(file)), /<RefreshEvery seconds=\{5\} \/>/, `${file} doesn't refresh itself`);
    }
    assert.match(withoutComments(await read("app/orders/page.tsx")), /<RefreshEvery \/>/);
    // Uncontrolled: a refresh hands it the same default, never a new value.
    const [replyBox] = openingTags(withoutComments(await read(`${CONVERSATION}/reply-form.tsx`)), ["Textarea"]);
    assert.ok(attributeValue(replyBox, "defaultValue") !== null && attributeValue(replyBox, "value") === null, "the reply box is controlled");
    // Keyed by what doesn't change on a refresh: the address's ?edit=, and
    // the request (a newer one gets a box of its own, notes and all).
    const page = withoutComments(await read(`${CONVERSATION}/page.tsx`));
    assert.equal(attributeValue(openingTags(page, ["ReplyForm"])[0], "key"), '{typeof edit === "string" ? edit : "new"}');
    assert.equal(attributeValue(openingTags(page, ["RequestBox"])[0], "key"), "{conversation.openTicket.id}");
  });

  await check("conversation page: the open request shows what it is about as plain text (the AI's summary, a call's note) and the request page's related knowledge; an email entry links the request it became", async () => {
    const box = withoutComments(await read(`${CONVERSATION}/request-box.tsx`));
    assert.match(box, /<p className="[^"]*whitespace-pre-wrap[^"]*">\{ticket\.description\}<\/p>/);
    assert.doesNotMatch(box, /dangerouslySetInnerHTML/);
    assert.match(box, /<RelatedArticles articles=\{relatedArticles\} \/>/);
    assert.match(withoutComments(await read(`${CONVERSATION}/page.tsx`)), /relatedArticles=\{request\?\.relatedArticles \?\? \[\]\}/);
    assert.match(withoutComments(await read(`${CONVERSATION}/conversation-timeline.tsx`)), /<Link href=\{`\/tickets\/\$\{entry\.email\.ticketNumber\}`\}/);
  });

  await check("conversation page: while ansa waits for your reply it says when it answers, in the viewer's own time, and offers Answer now only where core does (development, owners)", async () => {
    assert.match(withoutComments(await read(`${CONVERSATION}/page.tsx`)), /\{conversation\.assistantDueAt && \(\s*<AnswersAt /);
    const parts = withoutComments(await read(`${CONVERSATION}/conversation-parts.tsx`));
    assert.match(parts, /ansa answers at <LocalDateTime iso=\{dueAt\.toISOString\(\)\} timeOnly \/> unless you reply/);
    assert.match(parts, /\{canAnswerNow && \(\s*<ActionButton\s+action=\{answerNowAction\}/);
  });

  await check("conversation page: the open request's banner names only a button the request box offers (Done on a chat's request), and says ansa still answers a caller's calls", async () => {
    const parts = withoutComments(await read(`${CONVERSATION}/conversation-parts.tsx`));
    const box = withoutComments(await read(`${CONVERSATION}/request-box.tsx`));
    assert.match(box, /\{offersDone\(conversation, ticket\) \? \(/, "the box offers Done by the same rule");
    const banner = parts.slice(parts.indexOf("function openRequestText("));
    assert.ok(banner.indexOf("press Done") > banner.indexOf("if (offersDone(conversation, ticket))"), "Done is named only where it is offered");
    assert.equal(banner.split("press Done").length, 2, "Done is named once");
    assert.match(banner, /conversation\.channel === "phone"\) \{\s*return "[^"]*ansa still answers their calls"/);
  });

  await check("Calls pages: plain words for the team (how a call ended, never the provider's code, a reason code or an unknown model), 'request' where they said 'ticket', and live calls pointed to the Inbox, also from Home's call numbers", async () => {
    assert.equal(describeEndedReason("customer-ended-call"), "The caller hung up");
    assert.equal(describeEndedReason("pipeline-error-openai-llm-failed"), "A technical problem ended it");
    assert.equal(describeEndedReason("constructor"), "Another reason");
    assert.equal(describeEndedReason(null), "-");
    const files = ["app/calls/page.tsx", "app/calls/calls-table.tsx", "app/calls/[callId]/page.tsx", "app/calls/[callId]/call-decision.tsx", "app/calls/[callId]/escalate-call-form.tsx", "app/calls/[callId]/analyze-now-button.tsx"];
    for (const file of files) {
      const source = withoutComments(await read(file));
      assert.doesNotMatch(source, /a ticket|ticket #|Escalate to|Vapi|unknown model|<code>|\{call\.endedReason \?\?/, `${file} shows developer or old words`);
    }
    for (const file of ["app/calls/page.tsx", "app/dashboard/business-overview.tsx"]) {
      assert.match(withoutComments(await read(file)), /Calls ansa answered live [^<]*<Link href="\/inbox"/, `${file} doesn't point live calls to the Inbox`);
    }
  });

  await check("Try your assistant: the answer shows the question it answers, and a refused test puts what was typed back in the box", async () => {
    const box = withoutComments(await read("components/restaurant-setup/assistant-test-box.tsx"));
    assert.match(box, /\{state\.question\}/);
    assert.match(attributeValue(openingTags(box, ["Textarea"])[0], "defaultValue") ?? "", /state\.errors\.values\?\.text/);
    assert.match(withoutComments(await read("app/actions/assistant.ts")), /withTypedValues\(result\.errors, formData, \["text"\]\)/);
  });

  await check("handover reasons: the screens word each reason as core words it on the request and the alert (a table booking is handed over as an order, and says so)", async () => {
    const core = await read("core/internal/assistant/reasons.go");
    for (const [reason, text] of Object.entries(HANDOVER_REASON_TEXT)) {
      assert.ok(core.includes(`"${reason}":`) && core.includes(JSON.stringify(text)), `core words ${reason} differently`);
    }
    assert.match(HANDOVER_REASON_TEXT.order, /book a table/);
  });

  await check("handover reasons: a person (no menu) reads a stopped amount in their own words, as core writes it on the request and the alert; a business keeps its menu", async () => {
    const personal = handoverReasonText("price_not_on_menu", true);
    assert.doesNotMatch(personal, /menu/);
    assert.ok((await read("core/internal/assistant/reasons.go")).includes(JSON.stringify(personal)), "core words it differently");
    assert.equal(handoverReasonText("price_not_on_menu", false), HANDOVER_REASON_TEXT.price_not_on_menu);
    assert.equal(handoverReasonText("complaint", true), HANDOVER_REASON_TEXT.complaint);
    for (const file of [`${CONVERSATION}/conversation-parts.tsx`, "app/dashboard/away-panel.tsx"]) {
      assert.doesNotMatch(withoutComments(await read(file)), /HANDOVER_REASON_TEXT\[/, `${file} words a reason without the account's kind`);
    }
  });
}
