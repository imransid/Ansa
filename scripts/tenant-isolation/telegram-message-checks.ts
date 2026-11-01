// Telegram checks (step 48), part two: a customer's message joins their
// conversation once; what the restaurant writes in its own Telegram app
// says so; ansa's own replies coming back aren't saved twice; a reply goes
// through the restaurant's connection, and a refusal or no answer is
// recorded, never sent again; Telegram's 24 hours, a missing permission and
// no connection stop a reply before anything is saved; removing, adding
// back and disconnecting; deleted messages; the stand-in; another company
// sees none of it; the token is never logged.

import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { getLiveTelegramConnection } from "@/db/channel-connections";
import { db } from "@/db/client";
import { countConversations } from "@/db/conversations";
import { conversations, messages } from "@/db/schema";
import { getConversationPageForSession } from "@/services/conversation-page";
import { replyForSession } from "@/services/conversations";
import { connectStandInTelegramForSession, disconnectTelegramForSession } from "@/services/telegram-connect";
import { receiveStandInTelegramMessage } from "@/services/telegram-stand-in";
import { addTeammate, captureConsole, check, sessionFor, signUpTestOwner, type TestUser } from "./helpers";
import {
  businessConnection,
  businessMessage,
  connectCodeFor,
  connectionId,
  FAKE_BOT,
  fakeTelegram,
  postUpdate,
  REAL_MODE,
  sentAnswer,
  startMessage,
  telegramId,
} from "./telegram-check-helpers";

// An owner whose company has a connected Telegram account, its Telegram user, and the account's id.
async function connectedOwner(label: string): Promise<{ owner: TestUser; accountUser: number; externalId: string }> {
  const owner = await signUpTestOwner(label);
  const accountUser = telegramId();
  const externalId = connectionId(label);
  await postUpdate(startMessage(accountUser, `/start ${await connectCodeFor(owner)}`));
  await postUpdate(businessConnection(externalId, accountUser));
  assert.equal((await getLiveTelegramConnection(owner.companyId))?.status, "connected");
  return { owner, accountUser, externalId };
}

async function onlyConversationOf(owner: TestUser): Promise<string> {
  const rows = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.companyId, owner.companyId));
  assert.equal(rows.length, 1);
  return rows[0].id;
}

export async function runTelegramMessageChecks() {
  await check("telegram: a customer's message joins their conversation once; the restaurant's own Telegram message says so; ansa's replies coming back aren't saved again; a photo is named; another company and an unknown account see nothing", async () => {
    const { owner, accountUser, externalId } = await connectedOwner("telegram-messages");
    const other = await signUpTestOwner("telegram-other");
    const customer = telegramId();
    const first = telegramId();
    await postUpdate(businessMessage(externalId, customer, customer, { text: "Are you open tonight?" }, first));
    await postUpdate(businessMessage(externalId, customer, customer, { text: "Are you open tonight?" }, first));
    await postUpdate(businessMessage(externalId, customer, accountUser, { text: "Yes, until 23:00." }));
    await postUpdate(businessMessage(externalId, customer, accountUser, { text: "From the bot", sender_business_bot: { id: 1, is_bot: true, first_name: "ansa" } }));
    await postUpdate(businessMessage(externalId, customer, customer, { photo: [{ file_id: "x" }], caption: "This one?" }));
    await postUpdate(businessMessage(connectionId("nobody"), customer, customer, { text: "Lost" }));
    const conversationId = await onlyConversationOf(owner);
    const page = await getConversationPageForSession(sessionFor(owner), conversationId);
    assert.deepEqual(
      page?.entries.map((entry) => [entry.author, entry.text]),
      [
        ["customer", "Are you open tonight?"],
        ["business_account", "Yes, until 23:00."],
        ["customer", "[A photo: open Telegram to see it]\nThis one?"],
      ],
    );
    assert.deepEqual([page?.channel, page?.displayName, page?.replyBlocked], ["telegram", "Lena Moretti", null]);
    assert.equal(await getConversationPageForSession(sessionFor(other), conversationId), null);
    assert.equal((await countConversations(other.companyId)).all, 0);
  });

  await check("telegram: a reply goes through the restaurant's connection and keeps Telegram's id; a refusal is a code; no answer is 'unclear' and is asked once; the token is never logged", async () => {
    const { owner, externalId } = await connectedOwner("telegram-replies");
    const customer = telegramId();
    await postUpdate(businessMessage(externalId, customer, customer, { text: "Hello" }));
    const conversationId = await onlyConversationOf(owner);
    const sent = fakeTelegram(() => sentAnswer(4242));
    assert.deepEqual(await replyForSession(sessionFor(owner), { conversationId, text: "Hi Lena" }, { telegramMode: REAL_MODE, fetchFn: sent.fetchFn }), { ok: true });
    assert.deepEqual(sent.requests, [{ method: "sendMessage", body: { chat_id: String(customer), text: "Hi Lena", business_connection_id: externalId } }]);
    const refused = fakeTelegram(() => Response.json({ ok: false, error_code: 403, description: "Forbidden: secret words" }, { status: 403 }));
    const silent = fakeTelegram(() => {
      throw new TypeError(`fetch failed for https://api.telegram.org/bot${FAKE_BOT.token}/sendMessage`);
    });
    const { logs } = await captureConsole(async () => {
      await replyForSession(sessionFor(owner), { conversationId, text: "Second" }, { telegramMode: REAL_MODE, fetchFn: refused.fetchFn });
      await replyForSession(sessionFor(owner), { conversationId, text: "Third" }, { telegramMode: REAL_MODE, fetchFn: silent.fetchFn });
    });
    assert.equal(silent.requests.length, 1, "an unclear send was tried again");
    const replies = await db
      .select({ status: messages.sendStatus, error: messages.sendError, channelId: messages.channelMessageId })
      .from(messages)
      .where(and(eq(messages.companyId, owner.companyId), eq(messages.author, "person")))
      .orderBy(messages.createdAt);
    assert.deepEqual(replies, [
      { status: "sent", error: null, channelId: "4242" },
      { status: "failed", error: "refused", channelId: null },
      { status: "unclear", error: "no_answer", channelId: null },
    ]);
    assert.ok(!logs.join("\n").includes(FAKE_BOT.token.split(":")[1]), "the bot's token was logged");
    assert.ok(!logs.join("\n").includes("secret words"), "Telegram's own words were logged");
  });

  await check("telegram: past Telegram's 24 hours, without the permission to reply, or without a connection, a reply is refused before anything is saved or sent", async () => {
    const { owner, accountUser, externalId } = await connectedOwner("telegram-blocked");
    const customer = telegramId();
    await postUpdate(businessMessage(externalId, customer, customer, { text: "Hello" }));
    const conversationId = await onlyConversationOf(owner);
    const telegram = fakeTelegram();
    const reply = () => replyForSession(sessionFor(owner), { conversationId, text: "Late" }, { telegramMode: REAL_MODE, fetchFn: telegram.fetchFn });
    await db.update(conversations).set({ lastCustomerMessageAt: sql`now() - interval '25 hours'` }).where(eq(conversations.id, conversationId));
    assert.equal((await reply()).ok, false);
    assert.equal((await getConversationPageForSession(sessionFor(owner), conversationId))?.replyBlocked, "window-closed");
    await db.update(conversations).set({ lastCustomerMessageAt: sql`now()` }).where(eq(conversations.id, conversationId));
    await postUpdate(businessConnection(externalId, accountUser, { canReply: false }));
    assert.equal((await getLiveTelegramConnection(owner.companyId))?.status, "cannot_reply");
    assert.equal((await reply()).ok, false);
    assert.deepEqual(await disconnectTelegramForSession(sessionFor(owner)), { ok: true });
    assert.equal((await reply()).ok, false);
    assert.equal((await getConversationPageForSession(sessionFor(owner), conversationId))?.replyBlocked, "not-connected");
    const saved = await db.select({ id: messages.id }).from(messages).where(and(eq(messages.companyId, owner.companyId), eq(messages.author, "person")));
    assert.deepEqual([saved.length, telegram.requests.length], [0, 0]);
  });

  await check("telegram: removing the chatbot in Telegram stops its messages and adding it back resumes them; Disconnect is the owners' and stops them for good; messages deleted in Telegram are deleted in ansa", async () => {
    const { owner, accountUser, externalId } = await connectedOwner("telegram-lifecycle");
    const customer = telegramId();
    const kept = telegramId();
    const deleted = telegramId();
    await postUpdate(businessMessage(externalId, customer, customer, { text: "Keep me" }, kept));
    await postUpdate(businessMessage(externalId, customer, customer, { text: "Delete me" }, deleted));
    await postUpdate({ deleted_business_messages: { business_connection_id: externalId, chat: { id: customer, type: "private" }, message_ids: [deleted] } });
    await postUpdate(businessConnection(externalId, accountUser, { enabled: false }));
    assert.equal((await getLiveTelegramConnection(owner.companyId))?.status, "removed_in_telegram");
    await postUpdate(businessMessage(externalId, customer, customer, { text: "While removed" }));
    await postUpdate(businessConnection(externalId, accountUser));
    await postUpdate(businessMessage(externalId, customer, customer, { text: "Back again" }));
    const member = await addTeammate(owner, "telegram-lifecycle-member", "member");
    assert.equal((await disconnectTelegramForSession(sessionFor(member))).ok, false);
    assert.deepEqual(await disconnectTelegramForSession(sessionFor(owner)), { ok: true });
    await postUpdate(businessMessage(externalId, customer, customer, { text: "After disconnect" }));
    await postUpdate(businessConnection(externalId, accountUser));
    assert.equal(await getLiveTelegramConnection(owner.companyId), null, "a Telegram update reconnected an account an owner disconnected");
    const page = await getConversationPageForSession(sessionFor(owner), await onlyConversationOf(owner));
    assert.deepEqual(page?.entries.map((entry) => entry.text), ["Keep me", "Back again"]);
  });

  await check("telegram: the stand-in account (development) brings a message in through the same code, and a reply to it is written to .dev-messages/", async () => {
    const owner = await signUpTestOwner("telegram-stand-in");
    assert.equal(await receiveStandInTelegramMessage(owner.companyId, "Marco", "Hi"), "no-stand-in");
    assert.equal((await connectStandInTelegramForSession(sessionFor(owner), REAL_MODE)).ok, false, "a stand-in was connected beside a real bot");
    assert.deepEqual(await connectStandInTelegramForSession(sessionFor(owner), { kind: "stand-in" }), { ok: true });
    assert.equal(await receiveStandInTelegramMessage(owner.companyId, "Marco", "Table for two?"), "saved");
    const conversationId = await onlyConversationOf(owner);
    assert.deepEqual(await replyForSession(sessionFor(owner), { conversationId, text: "Of course" }), { ok: true });
    const page = await getConversationPageForSession(sessionFor(owner), conversationId);
    assert.deepEqual(page?.entries.map((entry) => [entry.author, entry.text, entry.sendStatus]), [
      ["customer", "Table for two?", null],
      ["person", "Of course", "sent"],
    ]);
  });
}
