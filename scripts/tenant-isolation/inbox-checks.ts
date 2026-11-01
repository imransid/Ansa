// Inbox checks (step 47): a call and a received email join their customer's
// conversation (the same customer the same one; a hidden caller none; an
// unverified sender one of its own); a chat message is saved once and
// messages keep their order; replying takes the conversation over and is
// recorded, the stand-in writes the reply to .dev-messages/ and production
// sends nothing; another company's conversation is never found or changed;
// "Needs you" is a conversation with an open request, and Home counts the same.

import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { STAND_IN_OUTBOX_DIR } from "@/adapters/dev-chat-outbox";
import { getSupportOverviewCounts } from "@/db/business-overview";
import { insertCallIfNew } from "@/db/calls";
import { db } from "@/db/client";
import { insertCustomerChatMessage } from "@/db/conversation-writes";
import { countConversations, listConversationEntries } from "@/db/conversations";
import { insertInboundEmailIfNew } from "@/db/inbound-emails";
import { saveInboundEmailTicket } from "@/db/inbound-email-processing";
import { createPhoneLine } from "@/db/phone-lines";
import { calls, conversations, inboundEmails, tickets } from "@/db/schema";
import { insertTicketWithNextNumber } from "@/db/ticket-creation";
import { sendChatMessage } from "@/lib/chat-delivery";
import { emailContact, phoneContact, standInContact } from "@/lib/conversation-contacts";
import { encryptText } from "@/lib/encryption";
import { conversationMessageContext, inboundEmailSubjectContext } from "@/lib/encryption-contexts";
import { getConversationPageForSession } from "@/services/conversation-page";
import { handBackForSession, receiveStandInMessage, replyForSession, takeOverForSession } from "@/services/conversations";
import { closeTicketWithoutEmailForSession } from "@/services/ticket-status";
import { addTeammate, check, runId, sessionFor, signUpTestOwner, type TestUser } from "./helpers";

const NO_EMAIL_CONTENT = { replyToAddress: null, bodyEncrypted: null, bodyFromHtml: false, attachmentCount: 0, attachmentNamesEncrypted: null, inlineImageCount: 0 };
const EMAIL_TICKET = { subject: "Cold pizza", description: "x", channel: "email" as const, category: null, customerName: null, customerEmail: null, customerPhone: null };

// A call from `callerNumber` saved for the company, as the Vapi webhook saves one.
async function saveCall(owner: TestUser, lineId: string, label: string, callerNumber: string | null): Promise<string> {
  const call = { phoneLineId: lineId, vapiCallId: `inbox-${label}-${runId}`, callerNumber, startedAt: null, endedAt: null, endedReason: null, transcriptEncrypted: null };
  const callId = await insertCallIfNew(owner.companyId, call, phoneContact(callerNumber));
  assert.ok(callId);
  return callId;
}

// A received email that becomes a ticket, from `from` (verified or not).
async function saveEmailTicket(owner: TestUser, label: string, from: string, verified: boolean) {
  const emailId = await insertInboundEmailIfNew(owner.companyId, `inbox-${label}-${runId}`);
  assert.ok(emailId);
  await db.update(inboundEmails).set({ status: "processing", processingStartedAt: new Date() }).where(eq(inboundEmails.id, emailId));
  const subjectEncrypted = encryptText("Cold pizza", inboundEmailSubjectContext(owner.companyId, emailId));
  const content = { ...NO_EMAIL_CONTENT, subjectEncrypted, fromAddress: from, senderVerified: verified };
  const saved = await saveInboundEmailTicket(owner.companyId, emailId, content, EMAIL_TICKET, emailContact(from, verified, null));
  assert.ok(saved);
  return { emailId, ticketId: saved.ticketId };
}

async function conversationOf(table: typeof calls | typeof inboundEmails | typeof tickets, id: string): Promise<string | null> {
  const [row] = await db.select({ conversationId: table.conversationId }).from(table).where(eq(table.id, id));
  return row?.conversationId ?? null;
}

export async function runInboxChecks() {
  await check("inbox: a call and a received email join their customer's conversation; the same customer the same one; a hidden caller none; an unverified sender one of its own; a call's ticket shows in the call's", async () => {
    const owner = await signUpTestOwner("inbox-links");
    const line = await createPhoneLine(owner.companyId, `inbox-line-${runId}`);
    const first = await saveCall(owner, line.id, "first", "+39 051 123 4567");
    const again = await saveCall(owner, line.id, "again", "+39 051-123-4567");
    assert.ok(await conversationOf(calls, first));
    assert.equal(await conversationOf(calls, again), await conversationOf(calls, first));
    assert.equal(await conversationOf(calls, await saveCall(owner, line.id, "hidden", "+266696687")), null);
    // The ticket made from a call joins the call's conversation.
    const ticket = await db.transaction((tx) => insertTicketWithNextNumber(tx, owner.companyId, { ...EMAIL_TICKET, channel: "phone" }, first));
    assert.equal(ticket.conversationId, await conversationOf(calls, first));
    // Emails: a verified sender by address, twice the same; an unverified one apart.
    const verified = await saveEmailTicket(owner, "verified", `Lena-${runId}@customer.test`, true);
    const verifiedAgain = await saveEmailTicket(owner, "verified-again", `lena-${runId}@customer.test`, true);
    const forged = await saveEmailTicket(owner, "forged", `lena-${runId}@customer.test`, false);
    const verifiedConversation = await conversationOf(inboundEmails, verified.emailId);
    assert.ok(verifiedConversation);
    assert.equal(await conversationOf(inboundEmails, verifiedAgain.emailId), verifiedConversation);
    assert.equal(await conversationOf(tickets, verified.ticketId), verifiedConversation);
    assert.notEqual(await conversationOf(inboundEmails, forged.emailId), verifiedConversation);
    assert.deepEqual([phoneContact("+266696687"), emailContact(null, true, "x")], [null, null]);
  });

  await check("inbox: a chat message is saved once, messages keep their order; replying takes the conversation over and is recorded; the stand-in writes it to .dev-messages/ and production sends nothing", async () => {
    const owner = await signUpTestOwner("inbox-chat");
    const contact = standInContact(`Marco ${runId}`);
    const ids: string[] = [];
    for (const channelMessageId of ["m1", "m2", "m3", "m2"]) {
      const messageId = crypto.randomUUID();
      const bodyEncrypted = encryptText(`Message ${channelMessageId}`, conversationMessageContext(owner.companyId, messageId));
      if (await insertCustomerChatMessage(owner.companyId, contact, { messageId, bodyEncrypted, channelMessageId })) {
        ids.push(messageId);
      }
    }
    const [conversation] = await db.select().from(conversations).where(eq(conversations.companyId, owner.companyId));
    const entries = await listConversationEntries(owner.companyId, conversation.id);
    assert.equal(ids.length, 3, "the same channel message was saved twice");
    assert.deepEqual(entries.map((entry) => entry.id), ids, "messages are out of order");
    // A reply through the service: sent by the stand-in, and the conversation is now a person's.
    await receiveStandInMessage(owner.companyId, `Marco ${runId}`, "Is the terrace open tonight?");
    assert.deepEqual(await replyForSession(sessionFor(owner), { conversationId: conversation.id, text: "Yes, from 18:00." }), { ok: true });
    const page = await getConversationPageForSession(sessionFor(owner), conversation.id);
    const reply = page?.entries.at(-1);
    assert.deepEqual([reply?.author, reply?.text, reply?.sendStatus, page?.handledBy], ["person", "Yes, from 18:00.", "sent", "person"]);
    assert.ok((await readdir(STAND_IN_OUTBOX_DIR)).some((file) => file.endsWith(`-${reply?.id}.json`)), "the stand-in wrote no file");
    assert.deepEqual(await handBackForSession(sessionFor(owner), { conversationId: conversation.id }), { ok: true });
    const history = (await getConversationPageForSession(sessionFor(owner), conversation.id))?.activity.map((row) => row.action);
    assert.deepEqual(history, ["handed_back", "taken_over"]);
    // Production never uses the stand-in; and calls or emails can't be answered.
    assert.deepEqual(await sendChatMessage({ channel: "stand_in", externalId: "x", telegram: null }, { id: "x", text: "x" }, { nodeEnv: "production" }), {
      status: "failed",
      error: "not_connected",
    });
  });

  await check("inbox: another company's conversation is never found, taken over or answered; a teammate works conversations like any ticket", async () => {
    const ownerA = await signUpTestOwner("inbox-a");
    const ownerB = await signUpTestOwner("inbox-b");
    const member = await addTeammate(ownerA, "inbox-member", "member");
    await receiveStandInMessage(ownerA.companyId, `Sofia ${runId}`, "Hello");
    const [conversation] = await db.select().from(conversations).where(eq(conversations.companyId, ownerA.companyId));
    const other = sessionFor(ownerB);
    assert.equal(await getConversationPageForSession(other, conversation.id), null);
    assert.equal((await takeOverForSession(other, { conversationId: conversation.id })).ok, false);
    assert.equal((await replyForSession(other, { conversationId: conversation.id, text: "Not yours" })).ok, false);
    assert.equal((await countConversations(ownerB.companyId)).all, 0);
    // A member takes it over and replies, like working a ticket.
    assert.deepEqual(await takeOverForSession(sessionFor(member), { conversationId: conversation.id }), { ok: true });
    assert.deepEqual(await replyForSession(sessionFor(member), { conversationId: conversation.id, text: "Hi Sofia" }), { ok: true });
    const page = await getConversationPageForSession(sessionFor(ownerA), conversation.id);
    assert.equal(page?.takenOverByName, "Invited");
  });

  await check("inbox: 'Needs you' is a conversation with an open request, and Home's count is the Inbox's", async () => {
    const owner = await signUpTestOwner("inbox-needs");
    const { ticketId } = await saveEmailTicket(owner, "needs", `pat-${runId}@customer.test`, true);
    await receiveStandInMessage(owner.companyId, `Quiet ${runId}`, "Thanks!");
    assert.deepEqual(await countConversations(owner.companyId), { "needs-you": 1, all: 2 });
    assert.equal((await getSupportOverviewCounts(owner.companyId, owner.id)).conversationsNeedingYou, 1);
    assert.deepEqual(await closeTicketWithoutEmailForSession(sessionFor(owner), { ticketId }), { ok: true });
    assert.equal((await countConversations(owner.companyId))["needs-you"], 0);
    assert.equal((await getSupportOverviewCounts(owner.companyId, owner.id)).conversationsNeedingYou, 0);
  });
}
