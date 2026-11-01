// Telegram checks (step 48), part one: the webhook refuses what isn't
// Telegram's before reading it; an owner's code, and only that, ties a
// Telegram account to a company, whichever comes first, the Start or the
// chatbot; the bot's settings come in threes; production never uses a
// stand-in; the daily job deletes old codes and waiting connections.
// Messages and replies: telegram-message-checks.ts.

import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { getLiveTelegramConnection } from "@/db/channel-connections";
import { db } from "@/db/client";
import { channelConnections, telegramLinkCodes, telegramPendingConnections } from "@/db/schema";
import { sendChatMessage } from "@/lib/chat-delivery";
import { parseEnv } from "@/lib/env";
import { BOT_NOTES } from "@/lib/telegram";
import { telegramModeFor } from "@/lib/telegram-mode";
import { runCleanup } from "@/services/maintenance";
import { startTelegramConnectForSession } from "@/services/telegram-connect";
import { handleTelegramWebhook } from "@/services/telegram-webhook";
import { addTeammate, check, sessionFor, signUpTestOwner } from "./helpers";
import {
  businessConnection,
  connectCodeFor,
  connectionId,
  FAKE_BOT,
  fakeTelegram,
  postUpdate,
  REAL_MODE,
  startMessage,
  telegramId,
} from "./telegram-check-helpers";

export async function runTelegramChecks() {
  await check("telegram: the webhook refuses a wrong or missing secret (401) and a body too large (413) before reading anything; without ansa's bot every request is refused; an update it can't read is answered 200 and changes nothing", async () => {
    assert.equal(await postUpdate({}, { secret: "wrong-secret-0123456789abcdef0123456789" }), 401);
    assert.equal(await postUpdate({}, { secret: null }), 401);
    const huge = new Request("http://localhost/api/webhooks/telegram", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": FAKE_BOT.webhookSecret, "x-forwarded-for": "198.51.100.48" },
      body: "x".repeat(300 * 1024),
    });
    assert.equal((await handleTelegramWebhook(huge, () => undefined, { mode: REAL_MODE })).status, 413);
    const signed = new Request("http://localhost/api/webhooks/telegram", { method: "POST", headers: { "x-telegram-bot-api-secret-token": FAKE_BOT.webhookSecret }, body: "{}" });
    assert.equal((await handleTelegramWebhook(signed, () => undefined, { mode: { kind: "stand-in" } })).status, 401);
    assert.equal(await postUpdate({ update_id: "not a number" }), 200);
    assert.equal(await postUpdate({ edited_business_message: { anything: true } }), 200);
  });

  await check("telegram: a Start with an owner's code, then the chatbot added, ties the account to that owner's company; the chatbot added first waits, and the Start ties it; a used or made-up code ties nothing; a member gets no code", async () => {
    const ownerA = await signUpTestOwner("telegram-link-a");
    const ownerB = await signUpTestOwner("telegram-link-b");
    const userA = telegramId();
    const telegram = fakeTelegram();
    // Start first, then the chatbot.
    const codeA = await connectCodeFor(ownerA);
    assert.equal(await postUpdate(startMessage(userA, `/start ${codeA}`), { fetchFn: telegram.fetchFn }), 200);
    assert.equal(await getLiveTelegramConnection(ownerA.companyId), null);
    assert.equal(await postUpdate(businessConnection(connectionId("a"), userA), { fetchFn: telegram.fetchFn }), 200);
    const connectionA = await getLiveTelegramConnection(ownerA.companyId);
    assert.deepEqual([connectionA?.status, connectionA?.displayName, connectionA?.isStandIn], ["connected", "Luigi's Trattoria", false]);
    assert.deepEqual(
      telegram.requests.map((request) => [request.body.text, request.body.business_connection_id]),
      [
        [BOT_NOTES.waitingForChatbot, undefined],
        [BOT_NOTES.connected, undefined],
      ],
    );
    // The chatbot first, then the Start.
    const userB = telegramId();
    await postUpdate(businessConnection(connectionId("b"), userB));
    assert.equal(await getLiveTelegramConnection(ownerB.companyId), null);
    await postUpdate(startMessage(userB, `/start ${await connectCodeFor(ownerB)}`));
    assert.equal((await getLiveTelegramConnection(ownerB.companyId))?.status, "connected");
    // A used code, a made-up one, and another Telegram user with A's used code.
    const stranger = telegramId();
    const notes = fakeTelegram();
    await postUpdate(startMessage(stranger, `/start ${codeA}`), { fetchFn: notes.fetchFn });
    await postUpdate(startMessage(stranger, `/start ${"x".repeat(43)}`), { fetchFn: notes.fetchFn });
    await postUpdate(businessConnection(connectionId("stranger"), stranger), { fetchFn: notes.fetchFn });
    assert.deepEqual(notes.requests.map((request) => request.body.text), [BOT_NOTES.linkExpired, BOT_NOTES.linkExpired, BOT_NOTES.needsLink]);
    // An account tied to a company stays there when its owner starts another company's code.
    await postUpdate(startMessage(userA, `/start ${await connectCodeFor(ownerB)}`), { fetchFn: notes.fetchFn });
    await postUpdate(businessConnection(connectionId("a"), userA), { fetchFn: notes.fetchFn });
    const tiedTo = await db.select({ companyId: channelConnections.companyId }).from(channelConnections).where(eq(channelConnections.externalId, connectionId("a")));
    assert.deepEqual(tiedTo, [{ companyId: ownerA.companyId }]);
    const member = await addTeammate(ownerA, "telegram-member", "member");
    assert.equal((await startTelegramConnectForSession(sessionFor(member), REAL_MODE)).ok, false);
    assert.equal((await startTelegramConnectForSession(sessionFor(ownerA), { kind: "not-set-up" })).ok, false);
  });

  await check("telegram: the bot's three settings are set together and checked for their shape; without them production is 'not set up' and never uses a stand-in", async () => {
    const off = { ...process.env, TELEGRAM_BOT_TOKEN: undefined, TELEGRAM_BOT_USERNAME: undefined, TELEGRAM_WEBHOOK_SECRET: undefined };
    const all = { TELEGRAM_BOT_TOKEN: FAKE_BOT.token, TELEGRAM_BOT_USERNAME: FAKE_BOT.username, TELEGRAM_WEBHOOK_SECRET: FAKE_BOT.webhookSecret };
    assert.equal(parseEnv({ ...off, ...all }).TELEGRAM_BOT_USERNAME, FAKE_BOT.username);
    assert.throws(() => parseEnv({ ...off, TELEGRAM_BOT_TOKEN: FAKE_BOT.token }), /TELEGRAM_WEBHOOK_SECRET/);
    assert.throws(() => parseEnv({ ...off, ...all, TELEGRAM_BOT_TOKEN: "not-a-token" }), /TELEGRAM_BOT_TOKEN/);
    assert.throws(() => parseEnv({ ...off, ...all, TELEGRAM_BOT_USERNAME: "@ansa_bot" }), /TELEGRAM_BOT_USERNAME/);
    assert.throws(() => parseEnv({ ...off, ...all, TELEGRAM_WEBHOOK_SECRET: "short" }), /TELEGRAM_WEBHOOK_SECRET/);
    assert.deepEqual(
      [telegramModeFor({}, "production").kind, telegramModeFor({}, "development").kind, telegramModeFor(all, "production").kind],
      ["not-set-up", "stand-in", "real"],
    );
    const standIn = { channel: "telegram" as const, externalId: "1", telegram: { businessConnectionId: "stand-in:x", isStandIn: true } };
    assert.deepEqual(await sendChatMessage(standIn, { id: "x", text: "x" }, { nodeEnv: "production" }), { status: "failed", error: "not_connected" });
  });

  await check("telegram: the daily job deletes link codes past their hour and connections that waited for a code in vain, and keeps the newer ones", async () => {
    const owner = await signUpTestOwner("telegram-cleanup");
    await connectCodeFor(owner);
    await db.insert(telegramLinkCodes).values({
      companyId: owner.companyId,
      createdByUserId: owner.id,
      codeHash: "0".repeat(64),
      createdAt: sql`now() - interval '2 hours'`,
      expiresAt: sql`now() - interval '115 minutes'`,
    });
    const facts = { accountTelegramId: "5", accountChatId: "5", displayName: "Old", canReply: true };
    await db.insert(telegramPendingConnections).values([
      { externalId: connectionId("old"), ...facts, receivedAt: sql`now() - interval '2 hours'` },
      { externalId: connectionId("new"), ...facts },
    ]);
    await runCleanup();
    const codes = await db.select({ hash: telegramLinkCodes.codeHash }).from(telegramLinkCodes).where(eq(telegramLinkCodes.companyId, owner.companyId));
    assert.equal(codes.length, 1);
    assert.notEqual(codes[0].hash, "0".repeat(64));
    const waiting = await db.select({ id: telegramPendingConnections.externalId }).from(telegramPendingConnections).where(sql`${telegramPendingConnections.externalId} IN (${connectionId("old")}, ${connectionId("new")})`);
    assert.deepEqual(waiting.map((row) => row.id), [connectionId("new")]);
  });
}
