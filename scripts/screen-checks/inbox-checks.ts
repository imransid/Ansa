// Home and Inbox checks (the fixes of 2026-11-03), on the code itself, as
// ui-polish-checks.ts does: the pages that wait for customers ask the
// server again while in view and keep what is typed; a conversation's open
// request says what it is about, with its related knowledge; an email
// entry links the request it became; ansa's wait for your reply shows its
// time; and "Try your assistant" shows the question it answers.

import assert from "node:assert/strict";
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

  await check("conversation page: \"Nothing needs you\" shows only without an open request and without a waiting \"Ask me first\" reply; a waiting reply says it needs you", async () => {
    const page = withoutComments(await read(`${CONVERSATION}/page.tsx`));
    assert.match(
      page,
      /\) : waiting \? \(\s*<StatusDot tone="attention">ansa&apos;s reply waits for you: Send, Edit or Discard it\.<\/StatusDot>\s*\) : \(\s*<StatusDot tone="success">Nothing needs you in this conversation\.<\/StatusDot>/,
    );
  });

  await check("live pages: a page that asks the server again starts the next refresh only once the last one is shown (a transition's isPending, never setInterval), so slow refreshes never pile up in front of a button's action", async () => {
    for (const file of ["components/refresh-every.tsx", "components/refresh-while-pending.tsx"]) {
      const source = withoutComments(await read(file));
      assert.doesNotMatch(source, /setInterval\(/, `${file} refreshes on an interval`);
      assert.match(source, /const \[isRefreshing, startRefresh\] = useTransition\(\);/, `${file} doesn't know when its refresh ends`);
      assert.match(source, /startRefresh\(\(\) => router\.refresh\(\)\)/, `${file} refreshes outside its transition`);
      assert.match(source, /if \(isRefreshing\b[^\n]*\) \{\n\s*return;/, `${file} plans a refresh while one runs`);
    }
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

  await check("Try your assistant: the answer shows the question it answers, and a refused test puts what was typed back in the box", async () => {
    const box = withoutComments(await read("components/restaurant-setup/assistant-test-box.tsx"));
    assert.match(box, /\{state\.question\}/);
    assert.match(attributeValue(openingTags(box, ["Textarea"])[0], "defaultValue") ?? "", /state\.errors\.values\?\.text/);
    assert.match(withoutComments(await read("app/actions/assistant.ts")), /withTypedValues\(result\.errors, formData, \["text"\]\)/);
  });
}
