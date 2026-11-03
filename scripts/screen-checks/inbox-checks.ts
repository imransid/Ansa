// Home and Inbox checks (the fixes of 2026-11-03), on the code itself, as
// ui-polish-checks.ts does: the pages that wait for customers ask the
// server again while in view and keep what is typed; a conversation's open
// request says what it is about, with its related knowledge; an email
// entry links the request it became; ansa's wait for your reply shows its
// time; and "Try your assistant" shows the question it answers.

import assert from "node:assert/strict";
import { check } from "./check";
import { attributeValue, openingTags, read, withoutComments } from "./source-helpers";

const CONVERSATION = "app/inbox/[conversationId]";

export async function runInboxChecks() {
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

  await check("Try your assistant: the answer shows the question it answers, and a refused test puts what was typed back in the box", async () => {
    const box = withoutComments(await read("components/restaurant-setup/assistant-test-box.tsx"));
    assert.match(box, /\{state\.question\}/);
    assert.match(attributeValue(openingTags(box, ["Textarea"])[0], "defaultValue") ?? "", /state\.errors\.values\?\.text/);
    assert.match(withoutComments(await read("app/actions/assistant.ts")), /withTypedValues\(result\.errors, formData, \["text"\]\)/);
  });
}
