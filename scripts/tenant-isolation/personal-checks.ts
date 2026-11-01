// Checks for steps 50 and 51, every one with a fake model: ansa set up for
// one person ("Just me") gets a person's steps, a person's AI label, prompt
// and holding reply; ansa answers only while they are away ("I'm away",
// away hours, or no answer from them in time: the catch-up then steps in,
// unless they answered meanwhile); someone marked important always goes to
// them; "While you were away" lists what ansa did until "Got it"; members
// and other companies can't change any of it.

import assert from "node:assert/strict";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { assistantSettings, companies, conversations } from "@/db/schema";
import { decideCover, type Availability } from "@/lib/assistant/availability";
import { PERSONAL_SYSTEM_PROMPT } from "@/lib/assistant/prompt";
import { setupStepsFor } from "@/lib/restaurant-setup";
import { runDueAssistantReplies } from "@/services/assistant-due";
import { getAwaySummaryForSession, markAwaySummarySeenForSession, setAwayForSession, setImportantForSession } from "@/services/away";
import { replyForSession } from "@/services/conversations";
import { completeChannelsStepForSession, finishSetupForSession, saveSetupSectionForSession } from "@/services/restaurant-setup";
import { answer, assistantMessages, customerWrites, fakeModel } from "./assistant-check-helpers";
import { addTeammate, check, runId, sessionFor, signUpTestOwner, type TestUser } from "./helpers";

// A person set up through the first two steps, with no away hours (so the
// checks never depend on the time they run), ansa stepping in after
// `graceMinutes` (or never).
async function setUpPerson(owner: TestUser, graceMinutes: string): Promise<void> {
  const who = { kind: "personal", companyName: `Rafa ${runId}`, description: "I build software." };
  assert.deepEqual(await saveSetupSectionForSession(sessionFor(owner), "business", who, "setup"), { ok: true, nextStep: "away" });
  const day = [{ opens: "", closes: "" }];
  const away = { timeZone: "Asia/Dhaka", replyGraceMinutes: graceMinutes, mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day };
  assert.deepEqual(await saveSetupSectionForSession(sessionFor(owner), "away", away, "setup"), { ok: true, nextStep: "assistant" });
}

// Noon in Dhaka (06:00 UTC): not one of the away hours above.
const DHAKA_NOON = new Date("2026-11-02T06:00:00Z");

export async function runPersonalChecks() {
  await check("personal: 'Just me' makes a person's account (no business kind, a person's steps, answering only while away, a holding reply with their name); a kind is required; a business needs its kind and description", async () => {
    const owner = await signUpTestOwner("personal-setup");
    assert.equal((await saveSetupSectionForSession(sessionFor(owner), "business", { companyName: "No kind" }, "setup")).ok, false);
    assert.equal((await saveSetupSectionForSession(sessionFor(owner), "business", { kind: "business", companyName: "Shop" }, "setup")).ok, false);
    await setUpPerson(owner, "");
    const [company] = await db.select({ kind: companies.kind, type: companies.businessType, progress: companies.setupProgress }).from(companies).where(eq(companies.id, owner.companyId));
    assert.deepEqual(company, { kind: "personal", type: null, progress: 2 });
    const [settings] = await db.select().from(assistantSettings).where(eq(assistantSettings.companyId, owner.companyId));
    assert.equal(settings.answerWhen, "when_away");
    assert.equal(settings.holdingReply, `Thanks for your message. Rafa ${runId} can't reply right now. I've passed it on, and Rafa ${runId} will get back to you soon.`);
    assert.deepEqual(setupStepsFor("personal").map((step) => step.key), ["business", "away", "assistant", "connect", "ready"]);
    // Back to a business: the later steps start again, and ansa answers every message.
    const shop = { kind: "business", companyName: `Shop ${runId}`, businessType: "cafe", description: "Coffee." };
    assert.deepEqual(await saveSetupSectionForSession(sessionFor(owner), "business", shop, "setup"), { ok: true, nextStep: "contact" });
    const [after] = await db.select({ progress: companies.setupProgress }).from(companies).where(eq(companies.id, owner.companyId));
    const [switched] = await db.select({ answerWhen: assistantSettings.answerWhen, holdingReply: assistantSettings.holdingReply }).from(assistantSettings).where(eq(assistantSettings.companyId, owner.companyId));
    assert.deepEqual([after.progress, switched.answerWhen, switched.holdingReply.startsWith("Thank you for your message. Our team")], [1, "always", true]);
  });

  await check("personal: when ansa answers is decided by 'I'm away', the away hours and the minutes it waits for you", async () => {
    const base: Availability = { answerWhen: "when_away", awaySince: null, awayHours: null, timeZone: "Asia/Dhaka", replyGraceMinutes: null };
    const nights = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [day, [{ opens: "00:00", closes: "07:00" }]])) as Availability["awayHours"];
    const atNight = new Date("2026-11-01T20:00:00Z"); // 02:00 in Dhaka
    assert.deepEqual(decideCover({ ...base, answerWhen: "always" }, DHAKA_NOON), { kind: "answer" });
    assert.deepEqual(decideCover({ ...base, awaySince: new Date() }, DHAKA_NOON), { kind: "answer" });
    assert.deepEqual(decideCover({ ...base, awayHours: nights }, atNight), { kind: "answer" });
    assert.deepEqual(decideCover({ ...base, awayHours: nights, replyGraceMinutes: 10 }, DHAKA_NOON), { kind: "wait", minutes: 10 });
    assert.deepEqual(decideCover({ ...base, awayHours: nights }, DHAKA_NOON), { kind: "leave" });
  });

  await check("personal: while you're available ansa waits your minutes and steps in only if you didn't answer; 'I'm away' makes it answer at once, as your AI assistant, from a person's prompt", async () => {
    const owner = await signUpTestOwner("personal-cover");
    await setUpPerson(owner, "10");
    const model = fakeModel(answer({ reply: "Rafa will see this later today." }));
    const waiting = await customerWrites(owner, "Mia", "Are you free tomorrow?", model.asker);
    assert.equal(waiting.outcome, "waiting");
    assert.equal(model.requests.length, 0, "the AI was asked while you were available");
    // Not due yet: nothing happens. Due: ansa steps in.
    assert.deepEqual(await runDueAssistantReplies(Date.now(), { asker: model.asker }, owner.companyId), { answered: 0, alreadyAnswered: 0 });
    await db.update(conversations).set({ assistantDueAt: new Date(Date.now() - 1_000) }).where(eq(conversations.id, waiting.turn.conversationId));
    assert.deepEqual(await runDueAssistantReplies(Date.now(), { asker: model.asker }, owner.companyId), { answered: 1, alreadyAnswered: 0 });
    const [reply] = await assistantMessages(owner, waiting.turn.conversationId);
    assert.equal(reply.text, `I'm Rafa ${runId}'s AI assistant.\nRafa will see this later today.`);
    assert.equal(model.requests[0].systemPrompt, PERSONAL_SYSTEM_PROMPT);
    assert.match(model.requests[0].prompt, /<person>\nName: Rafa .*\nWhat they do: I build software\.\n<\/person>/);
    assert.ok(!model.requests[0].prompt.includes("<menu>") && !model.requests[0].prompt.includes("<ordering>"));
    // You answer yourself in time: ansa doesn't step in.
    const second = await customerWrites(owner, "Noa", "Hi!", model.asker);
    assert.equal(second.outcome, "waiting");
    assert.deepEqual(await replyForSession(sessionFor(owner), { conversationId: second.turn.conversationId, text: "Hi Noa!" }), { ok: true });
    const stillDue = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, second.turn.conversationId), isNotNull(conversations.assistantDueAt)));
    assert.equal(stillDue.length, 0);
    // "I'm away": ansa answers at once.
    assert.deepEqual(await setAwayForSession(sessionFor(owner), { away: "on" }), { ok: true });
    assert.equal((await customerWrites(owner, "Ola", "Hello?", model.asker)).outcome, "replied");
  });

  await check("personal: someone marked important always goes to you (holding reply, a note, an alert) without asking the AI; 'While you were away' lists what ansa did until 'Got it'; members and other companies change none of it", async () => {
    const owner = await signUpTestOwner("personal-important");
    const other = await signUpTestOwner("personal-other");
    await setUpPerson(owner, "");
    // A person's setup finishes after its four steps (no address, hours or orders).
    assert.equal((await finishSetupForSession(sessionFor(owner))).ok, false);
    const texts = { instructions: "", holdingReply: "Thanks! I'll pass it on." };
    assert.deepEqual(await saveSetupSectionForSession(sessionFor(owner), "assistant", texts, "setup"), { ok: true, nextStep: "connect" });
    assert.deepEqual(await completeChannelsStepForSession(sessionFor(owner)), { ok: true });
    assert.deepEqual(await finishSetupForSession(sessionFor(owner)), { ok: true });
    assert.deepEqual(await setAwayForSession(sessionFor(owner), { away: "on" }), { ok: true });
    const model = fakeModel(answer({ reply: "Hello from ansa." }));
    const first = await customerWrites(owner, "Mum", "Call me", model.asker);
    assert.equal(first.outcome, "replied");
    assert.deepEqual(await setImportantForSession(sessionFor(owner), { conversationId: first.turn.conversationId, important: "on" }), { ok: true });
    assert.equal((await setImportantForSession(sessionFor(other), { conversationId: first.turn.conversationId, important: "off" })).ok, false);
    const again = await customerWrites(owner, "Mum", "Please call me", model.asker);
    assert.deepEqual([again.outcome, model.requests.length], ["handed-over", 1]);
    const summary = await getAwaySummaryForSession(sessionFor(owner));
    assert.deepEqual([summary.replies, summary.notes, summary.conversations.length, summary.conversations[0].reason], [1, 1, 1, "important_person"]);
    assert.deepEqual(await markAwaySummarySeenForSession(sessionFor(owner)), { ok: true });
    assert.equal((await getAwaySummaryForSession(sessionFor(owner))).conversations.length, 0);
    const member = await addTeammate(owner, "personal-member", "member");
    assert.equal((await setAwayForSession(sessionFor(member), { away: "off" })).ok, false);
    assert.equal((await getAwaySummaryForSession(sessionFor(other))).conversations.length, 0);
  });
}
