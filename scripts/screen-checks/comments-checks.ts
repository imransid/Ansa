// Facebook comment checks, on the pure words and on the code itself, as
// ui-polish-checks.ts does: ansa answers comments on a business's Facebook
// Page posts. Inbox → Comments lists them with what ansa did (its waiting
// answers sent or discarded there), Settings → Connections switches it on,
// the practice chat writes one, and the legal pages and the website say so.

import assert from "node:assert/strict";
import { COMMENT_KIND_LABELS, COMMENT_SKIP_TEXT, commentReplyStatusText } from "@/lib/comments";
import { SOCIAL_PLATFORM_FACTS } from "@/lib/social-platforms";
import { WEBSITE_CHANNELS } from "@/lib/website-channels";
import { check } from "./check";
import { read, withoutComments } from "./source-helpers";

const PAGE = "app/inbox/comments";
const CONNECTIONS = "app/settings/channels";
const PRACTICE = `${CONNECTIONS}/practice-chat`;

// What core sends (the API contract of GET /api/v1/comments).
const SKIP_REASONS = ["", "thanks", "spam", "own_comment", "reply_in_thread", "comments_off", "package", "limit", "too_old", "not_allowed", "discarded"];
const KINDS = ["question", "order", "complaint", "thanks", "spam", "unsure"];

export async function runCommentsChecks() {
  await check("comments: every reason ansa leaves a comment, every kind and every reply's state core sends has words for an owner (never its code), and the types hold core's values exactly", async () => {
    assert.deepEqual(Object.keys(COMMENT_SKIP_TEXT).sort(), [...SKIP_REASONS].sort());
    assert.deepEqual(Object.keys(COMMENT_KIND_LABELS).sort(), [...KINDS].sort());
    const words = [...Object.values(COMMENT_SKIP_TEXT), ...Object.values(COMMENT_KIND_LABELS)];
    for (const status of ["sent", "failed", "unclear", "waiting"] as const) {
      for (const where of ["post", "messenger"] as const) {
        words.push(commentReplyStatusText(status, where));
      }
    }
    for (const text of words) {
      assert.ok(text.trim().length > 0 && !text.includes("_"), `"${text}" isn't words for an owner`);
    }
    assert.match(commentReplyStatusText("unclear", "messenger"), /check Messenger/);
    const types = withoutComments(await read("lib/types/comments.ts"));
    assert.match(types, /export type CommentStatus = "new" \| "answered" \| "waiting" \| "skipped" \| "failed";/);
    assert.match(types, /export type CommentReplyStatus = "sent" \| "failed" \| "unclear" \| "waiting";/);
    assert.match(types, /export type PracticeCommentRead = PageComment & \{ next: "answering" \| "done" \};/);
    assert.match(types, /export type CommentsPage = \{ comments: PageComment\[\]; total: number; page: number; pageSize: number; commentsOn: boolean \};/);
  });

  await check("comments page: Inbox → Comments has its h1, reads the session inside <Suspense> with its own address, asks the server again every 5 seconds, pages with ?page=, and says when answering comments is off with a link to the switch; the Inbox and All requests link it for a business", async () => {
    const page = withoutComments(await read(`${PAGE}/page.tsx`));
    assert.match(page, /<h1 className="[^"]*">Comments<\/h1>/);
    assert.match(page, /<Suspense fallback=\{<PageLoading \/>\}>\s*<CommentsContent /);
    assert.match(page.slice(page.indexOf("async function CommentsContent(")), /await requireSessionContext\("\/inbox\/comments"\);/);
    assert.match(page, /<RefreshEvery seconds=\{5\} \/>/);
    assert.match(page, /<PaginationLinks basePath="\/inbox\/comments" page=\{page\} totalRows=\{total\} \/>/);
    assert.match(page, /\{!commentsOn && \(\s*<p[^>]*>\s*ansa doesn&apos;t answer comments right now\. Switch it on in\{" "\}\s*<Link href="\/settings\/channels#comments-heading"/);
    assert.match(withoutComments(await read(`${CONNECTIONS}/page-comments.tsx`)), /<h3 id="comments-heading"/);
    const inbox = withoutComments(await read("app/inbox/page.tsx"));
    assert.match(inbox, /\{!personal && \(\s*<>\s*<Link href="\/inbox\/comments"/);
    const requests = withoutComments(await read("app/inbox/requests/page.tsx"));
    assert.match(requests, /\{kind !== "personal" && \(\s*<>\s*<Link href="\/inbox\/comments"/);
  });

  await check("comments page: ansa's answers waiting for a person (Ask me first) are sent or discarded there only while the comment waits, Discard asks first, and core's \"changed\" (no longer waiting) is said, never taken for done", async () => {
    const outcome = withoutComments(await read(`${PAGE}/comment-outcome.tsx`));
    assert.match(outcome, /\{comment\.status === "waiting" && <WaitingReplyButtons /);
    assert.match(outcome, /<ActionButton action=\{sendCommentReplyAction\} fields=\{fields\}/);
    assert.match(outcome, /<ConfirmButton\s+action=\{discardCommentReplyAction\}\s+fields=\{fields\}/);
    const views = withoutComments(await read("lib/core-views/comments.ts"));
    assert.match(views, /callCore<\{ outcome: CommentOutcome \}>\("POST", `\/api\/v1\/comments\/\$\{encodeURIComponent\(commentId\)\}\/\$\{action\}`, \{\}\)/);
    assert.match(views, /answer\.data\.outcome === "changed" \? \{ ok: false, errors: \{ message: NO_LONGER_WAITING \} \} : \{ ok: true \}/);
  });

  await check("comments page: what ansa did links the Messenger conversation its private message opened and the request it passed on, and an unreadable comment says so instead of showing nothing", async () => {
    const outcome = withoutComments(await read(`${PAGE}/comment-outcome.tsx`));
    assert.match(outcome, /\{privateMessage\.conversationId !== "" && \(\s*<Link href=\{`\/inbox\/\$\{privateMessage\.conversationId\}`\}/);
    assert.match(outcome, /\{requestNumber > 0 && \(\s*<p[^>]*>\s*Passed to you:\{" "\}\s*<Link href=\{`\/tickets\/\$\{requestNumber\}`\}/);
    assert.match(outcome, /ansa left it: \{COMMENT_SKIP_TEXT\[comment\.skipReason\]\}/);
    assert.match(withoutComments(await read(`${PAGE}/comment-list.tsx`)), /if \(!comment\.readable\) \{\s*return <p/);
  });

  await check("connections: a business's Facebook Page card says what ansa does with comments; owners switch it (Save, then Saved.), members read it; a Page without the comment permissions asks to be connected again; the stand-in's note links the practice chat, the permission names folded away for developers", async () => {
    const channels = withoutComments(await read(`${CONNECTIONS}/page.tsx`));
    assert.match(channels, /return kind === "business" && messenger\.inPackage && messenger\.mode !== "not-set-up";/);
    assert.match(channels, /comments=\{comments && <PageComments settings=\{comments\} mode=\{page\.messenger\.mode\} \/>\}/);
    const part = withoutComments(await read(`${CONNECTIONS}/page-comments.tsx`));
    assert.match(part, /\{settings\.canChange \? \(\s*<CommentsSwitch on=\{settings\.on\} \/>\s*\) : \(/);
    assert.match(part, /\{settings\.on \? "on" : "off"\}\. Only owners change it\./);
    assert.match(part, /<StatusDot tone="attention">Connect it again and allow comments<\/StatusDot>/);
    assert.match(part, /\{mode === "stand-in" \? \(\s*<StandInCommentsNote \/>/);
    assert.match(part, /href="\/settings\/channels\/practice-chat"/);
    const shown = part.replace(/<ForDevelopers>[\s\S]*?<\/ForDevelopers>/g, "");
    assert.doesNotMatch(shown, /pages_\w+/, "permission names shown outside the fold");
    assert.match(part, /<ForDevelopers>[\s\S]*pages_read_user_content[\s\S]*pages_manage_engagement[\s\S]*<\/ForDevelopers>/);
    const form = withoutComments(await read(`${CONNECTIONS}/comments-switch.tsx`));
    assert.match(form, /<Checkbox name="answerComments" defaultChecked=\{on\}/);
    assert.match(form, /startTransition\(\(\) => saveAction\(formData\)\)/);
    assert.match(form, /<SavedNote saved=\{state\?\.saved === true && !isSaving && !changedSinceSave\} \/>/);
    assert.match(withoutComments(await read("app/actions/comments.ts")), /saveCommentSettingsThroughCore\(formData\.get\("answerComments"\) === "on"\)/);
  });

  await check("practice chat: a business comments under the stand-in Page's posts (Facebook comment, greyed out without the stand-in Page); the next look at the comment starts only once the one before ended, none while a comment is being sent, and none once ansa is done; a failed call says ansa couldn't be reached; the private message opens the practice chat's Messenger chat of the same name", async () => {
    const who = withoutComments(await read(`${PRACTICE}/who-writes.tsx`));
    assert.match(who, /\{!personal && \(\s*<Button[\s\S]*?disabled=\{!canComment\}[\s\S]*?Facebook comment\s*<\/Button>/);
    const chat = withoutComments(await read(`${PRACTICE}/practice-chat.tsx`));
    assert.match(chat, /canComment=\{commentPosts\.length > 0 && standIns\.messenger\}/);
    const open = chat.slice(chat.indexOf("function openMessengerChat("), chat.indexOf("useFindChat("));
    assert.match(open, /changeCustomer\("messenger", commenter\);\s*setLookups\(/, "the Messenger chat isn't looked up again");
    assert.match(withoutComments(await read(`${PRACTICE}/use-find-chat.ts`)), /\}, \[channel, name, available, lookups, setConversationId, setChat\]\);/);
    assert.match(withoutComments(await read(`${PRACTICE}/page.tsx`)), /kind === "personal" \? \[\] : await getPracticeCommentPostsFromCore\(\)/);
    const comment = withoutComments(await read(`${PRACTICE}/practice-comment.tsx`));
    assert.doesNotMatch(comment, /setInterval/);
    assert.match(comment, /if \(!stopped && \(next === null \|\| stillChanging\(next\)\)\) \{\s*timer = setTimeout\(look, LOOK_EVERY_MS\);/);
    assert.match(comment, /const next = sending\.current \? null : await readPracticeCommentAction\(\{ commentId \}\)\.catch\(\(\) => null\);/);
    assert.match(comment, /await sendPracticeCommentAction\(\{ postId, name: commenter, text: comment \}\)\.catch\(\(\) => null\);\s*if \(!sent\) \{/);
    assert.match(comment, /const COULD_NOT_REACH = "ansa couldn't be reached just now\./);
    assert.match(withoutComments(await read(`${PRACTICE}/comment-thread.tsx`)), /onClick=\{\(\) => onOpenMessengerChat\(commenter\)\}/);
  });

  await check("Facebook: what ansa's Meta app needs names the two comment permissions; the privacy policy says what is kept of a comment and what Meta and Anthropic get; the website keeps comments 'soon' with Messenger", async () => {
    for (const permission of ["pages_read_user_content", "pages_manage_engagement"]) {
      assert.ok(SOCIAL_PLATFORM_FACTS.facebook.accessBlocker.includes(permission), `the access blocker doesn't name ${permission}`);
    }
    assert.match(await read("app/(marketing)/privacy/what-we-store.tsx"), /Comments on your Facebook Page&apos;s posts: the commenter&apos;s name and the comment&apos;s text as Meta gives them/);
    const helpers = (await read("app/(marketing)/privacy/who-helps.tsx")).replace(/\s+/g, " ");
    assert.ok(helpers.includes("brings us the comments on your Page&apos;s posts"), "Meta's part doesn't name comments");
    assert.ok(helpers.includes("It reads a comment on your Facebook Page&apos;s posts"), "Anthropic's part doesn't name comments");
    const facebook = WEBSITE_CHANNELS.find((channel) => channel.name === "Facebook Messenger");
    assert.ok(facebook && facebook.status === "soon" && facebook.note.includes("comments"));
  });
}
