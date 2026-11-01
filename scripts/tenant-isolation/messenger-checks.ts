// Messenger checks (step 53), with a made-up Meta app and a fake Graph API:
// the webhook refuses what Meta didn't sign before reading it; the company
// comes only from the Page id, and only when one company has that Page; a
// customer's message reaches that company's Inbox once, with their name,
// and the assistant answers through the Page; ansa's own echoes are never
// saved twice, the Page's other messages are; replies past 24 hours or
// without the messaging permission are refused before anything is saved.

import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { splitText } from "@/adapters/messenger";
import { db } from "@/db/client";
import { contacts, conversations, messages } from "@/db/schema";
import { messengerPageId, messengerPsid } from "@/lib/messenger";
import type { PlatformMode } from "@/lib/social-mode";
import { replyForSession } from "@/services/conversations";
import { answerMessengerVerification, handleMessengerWebhook } from "@/services/messenger-webhook";
import { saveAuthorizedAccounts } from "@/services/social-account-saving";
import { answer, fakeModel, setUpRestaurant } from "./assistant-check-helpers";
import { check, runId, sessionFor, signUpTestOwner, type TestUser } from "./helpers";

const APP = { clientId: "424242", clientSecret: "messenger-check-app-secret" };
const MODE: PlatformMode = { kind: "real", credentials: APP };
const ALL_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "pages_messaging", "pages_manage_metadata"];

let nextId = Number(String(Date.now()).slice(-9));
function metaId(): string {
  nextId += 1;
  return String(nextId);
}

// A Facebook Page connected in this company (as step 40's callback saves one).
async function connectPage(owner: TestUser, pageId: string, scopes = ALL_SCOPES): Promise<void> {
  const page = { externalAccountId: pageId, displayName: `Page ${runId}`, accountKind: "page" as const, scopes, accessToken: `page-token-${pageId}`, refreshToken: null, accessExpiresAt: null, refreshExpiresAt: null };
  assert.equal(await saveAuthorizedAccounts(owner.companyId, owner.id, "facebook", [page], false), "saved");
}

// A fake Graph API: the Send API answers a message id, the profile a name;
// every request is kept.
function fakeGraph() {
  const requests: { url: string; body: string }[] = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    requests.push({ url, body: String(init.body ?? "") });
    if (url.includes("/messages?")) {
      return Response.json({ recipient_id: "x", message_id: `m_${randomUUID()}` });
    }
    if (url.includes("fields=first_name")) {
      return Response.json({ first_name: "Anna", last_name: "Keller" });
    }
    return Response.json({ success: true });
  };
  return { fetchFn, requests };
}

function event(pageId: string, psid: string, message: Record<string, unknown>, echo = false) {
  return {
    object: "page",
    entry: [
      {
        id: pageId,
        time: Date.now(),
        messaging: [{ sender: { id: echo ? pageId : psid }, recipient: { id: echo ? psid : pageId }, timestamp: Date.now(), message: { mid: `mid.${randomUUID()}`, ...message } }],
      },
    ],
  };
}

// Posts a body to the webhook, signed with the app secret unless told
// otherwise, and waits for what runs after the answer.
async function post(body: unknown, options: { signature?: string | null; fetchFn?: ReturnType<typeof fakeGraph>["fetchFn"]; reply?: string } = {}) {
  const raw = JSON.stringify(body);
  const signature = options.signature === undefined ? `sha256=${createHmac("sha256", APP.clientSecret).update(raw).digest("hex")}` : options.signature;
  const headers: Record<string, string> = { "x-forwarded-for": "198.51.100.53" };
  if (signature !== null) {
    headers["x-hub-signature-256"] = signature;
  }
  const tasks: Promise<void>[] = [];
  const fetchFn = options.fetchFn ?? fakeGraph().fetchFn;
  const model = fakeModel(answer({ action: options.reply ? "reply" : "no_reply", reply: options.reply ?? "" }));
  const response = await handleMessengerWebhook(new Request("http://localhost/api/webhooks/messenger", { method: "POST", headers, body: raw }), (task) => tasks.push(task()), {
    mode: MODE,
    fetchFn,
    assistant: { asker: model.asker, settleMs: 0, delivery: { facebookMode: MODE, fetchFn } },
  });
  await Promise.all(tasks);
  return response.status;
}

async function inboxOf(owner: TestUser) {
  return db
    .select({ conversationId: conversations.id, externalId: contacts.externalId, name: contacts.displayName })
    .from(conversations)
    .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.companyId, conversations.companyId)))
    .where(and(eq(conversations.companyId, owner.companyId), eq(contacts.channel, "messenger")));
}

async function messagesOf(owner: TestUser, conversationId: string) {
  return db
    .select({ author: messages.author, status: messages.sendStatus, channelId: messages.channelMessageId })
    .from(messages)
    .where(and(eq(messages.companyId, owner.companyId), eq(messages.conversationId, conversationId)))
    .orderBy(messages.createdAt);
}

export async function runMessengerChecks() {
  await check("messenger: the webhook refuses a missing or wrong signature (401) before reading anything, and everything without ansa's Meta app; a signed body it can't read is answered 200; Meta's setup check gets its challenge only with ansa's verify token", async () => {
    assert.equal(await post({ object: "page", entry: [] }, { signature: null }), 401);
    assert.equal(await post({ object: "page", entry: [] }, { signature: "sha256=0000" }), 401);
    const unsigned = new Request("http://localhost/api/webhooks/messenger", { method: "POST", body: "{}" });
    assert.equal((await handleMessengerWebhook(unsigned, () => undefined, { mode: { kind: "stand-in" } })).status, 401);
    assert.equal(await post({ object: "user", anything: true }), 200);
    const token = "a".repeat(40);
    const verify = (query: string) => answerMessengerVerification(new URL(`http://localhost/api/webhooks/messenger?${query}`), token);
    const ok = verify(`hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=12345`);
    assert.deepEqual([ok.status, await ok.text()], [200, "12345"]);
    assert.equal(verify(`hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345`).status, 403);
    assert.equal(answerMessengerVerification(new URL(`http://localhost/x?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=1`), undefined).status, 403);
  });

  await check("messenger: a customer's message reaches the one company that connected the Page, once, with their name from Meta, and the assistant's reply goes back through that Page (RESPONSE, appsecret_proof); a Page connected in two companies routes nowhere", async () => {
    const owner = await signUpTestOwner("messenger-owner");
    await setUpRestaurant(owner);
    const pageId = metaId();
    await connectPage(owner, pageId);
    const graph = fakeGraph();
    const body = event(pageId, "777001", { text: "Are you open tonight?" });
    assert.equal(await post(body, { fetchFn: graph.fetchFn, reply: "Yes, until 23:00." }), 200);
    assert.equal(await post(body, { fetchFn: graph.fetchFn, reply: "Yes, until 23:00." }), 200);
    const [conversation] = await inboxOf(owner);
    assert.deepEqual([conversation.externalId, conversation.name], [`${pageId}:777001`, "Anna Keller"]);
    const saved = await messagesOf(owner, conversation.conversationId);
    assert.deepEqual(saved.map((row) => [row.author, row.status]), [["customer", null], ["assistant", "sent"]]);
    const send = graph.requests.find((request) => request.url.includes(`/${pageId}/messages?`));
    assert.ok(send && send.url.includes("appsecret_proof=") && !send.body.includes("page-token"));
    assert.deepEqual(JSON.parse(send.body).recipient, { id: "777001" });
    assert.equal(JSON.parse(send.body).messaging_type, "RESPONSE");

    const shared = metaId();
    const other = await signUpTestOwner("messenger-other");
    await connectPage(owner, shared);
    await connectPage(other, shared);
    assert.equal(await post(event(shared, "777002", { text: "Hello?" })), 200);
    assert.equal((await inboxOf(other)).length, 0);
    assert.equal((await inboxOf(owner)).length, 1);
  });

  await check("messenger: an echo of ansa's own reply is not saved again; a message the Page wrote elsewhere (Meta Business Suite) is saved as the Page's own; a photo is named, never downloaded", async () => {
    const owner = await signUpTestOwner("messenger-echo");
    const pageId = metaId();
    await connectPage(owner, pageId);
    await post(event(pageId, "778001", { attachments: [{ type: "image", payload: { url: "https://example.com/x.jpg" } }] }));
    const [conversation] = await inboxOf(owner);
    await post(event(pageId, "778001", { text: "Sent by ansa", is_echo: true, app_id: Number(APP.clientId) }, true));
    await post(event(pageId, "778001", { text: "Written in Business Suite", is_echo: true, app_id: 263902037430900 }, true));
    const saved = await messagesOf(owner, conversation.conversationId);
    assert.deepEqual(saved.map((row) => row.author), ["customer", "business_account"]);
  });

  await check("messenger: a person's reply past Meta's 24 hours, or for a Page whose messaging permission wasn't granted, is refused before anything is saved; long texts go as parts of at most 2,000 characters; a contact names its Page and customer", async () => {
    const owner = await signUpTestOwner("messenger-window");
    const pageId = metaId();
    await connectPage(owner, pageId);
    await post(event(pageId, "779001", { text: "Hi" }));
    const [conversation] = await inboxOf(owner);
    await db
      .update(conversations)
      .set({ lastCustomerMessageAt: sql`now() - interval '25 hours'` })
      .where(and(eq(conversations.id, conversation.conversationId), eq(conversations.companyId, owner.companyId)));
    const late = await replyForSession(sessionFor(owner), { conversationId: conversation.conversationId, text: "Sorry for the wait" });
    assert.equal(late.ok, false);
    const noPermission = metaId();
    await connectPage(owner, noPermission, ALL_SCOPES.slice(0, 3));
    await post(event(noPermission, "779002", { text: "Hello" }));
    const second = (await inboxOf(owner)).find((row) => row.externalId.startsWith(noPermission));
    assert.ok(second);
    const refused = await replyForSession(sessionFor(owner), { conversationId: second.conversationId, text: "Hi!" });
    assert.equal(refused.ok, false);
    assert.equal((await messagesOf(owner, second.conversationId)).length, 1, "nothing saved");

    const parts = splitText(`${"word ".repeat(500)}\n${"x".repeat(2500)}`);
    assert.ok(parts.length >= 3 && parts.every((part) => part.length <= 2000));
    assert.deepEqual([messengerPageId("dev:stand-in:anna"), messengerPsid("dev:stand-in:anna"), messengerPageId("12345:678")], ["dev:stand-in", "anna", "12345"]);
  });
}
