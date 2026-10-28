// Business overview checks (step 43): the dashboard's numbers from support
// and from the Co-Founder are the company's own, match the lists they link
// to, read no more than one row past 10,000 each, and the Co-Founder's half
// shows only once the company started it (one line inviting an owner
// before). Through the real services and /db; fake platforms only.

import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { createPhoneLine } from "@/db/phone-lines";
import { calls, inboundEmails, publishJobs, socialConnections, type CallOutcome } from "@/db/schema";
import { formatOverviewCount, OVERVIEW_COUNT_LIMIT } from "@/lib/business-overview";
import { getBusinessOverviewForSession } from "@/services/business-overview";
import { getQueuePageForSession } from "@/services/publishing-pages";
import { closeTicketWithoutEmailForSession } from "@/services/ticket-status";
import { assignTicketForSession, countTicketsPerViewForSession, createTicketForCompany } from "@/services/tickets";
import { saveTestCall } from "./brain-test-calls";
import { answerLikeThePage, scriptedModel, typeFact } from "./cofounder-helpers";
import { blankDraftId, generatedDraftId, LINKEDIN_POST } from "./content-studio-helpers";
import { addTeammate, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { receiveEmailRow } from "./inbound-helpers";
import { anotherApprovedDraft, approvedDraftOf, inMinutes, realLinkedInAccount, scheduledJobIds, standInAccount } from "./publishing-helpers";

const DAY_MS = 24 * 60 * 60 * 1000;

// Marks a call decided, as the call brain would (straight in the database:
// these checks are about the counts, not the brain).
async function markDecided(callId: string, outcome: CallOutcome, savedDaysAgo = 0) {
  const decided = { analysisStatus: "decided" as const, aiOutcome: outcome, aiDecisionSource: "rule" as const, aiReasonCode: "overview_check", decidedAt: new Date() };
  await db
    .update(calls)
    .set({ ...decided, createdAt: new Date(Date.now() - savedDaysAgo * DAY_MS) })
    .where(eq(calls.id, callId));
}

// One open ticket typed in for the company: its id.
async function openTicket(companyId: string, subject: string): Promise<string> {
  const ticket = await createTicketForCompany(companyId, { subject: `${subject} ${runId}`, description: "Made by the overview checks.", channel: "phone" });
  return ticket.id;
}

export async function runBusinessOverviewChecks() {
  await check("business overview: the support numbers are the company's own and count what their links open: open and unassigned tickets as the ticket views count them, calls of the last 7 days and those the AI solved, received emails still being turned into tickets and stuck ones; another company's never count", async () => {
    const ownerUser = await signUpTestOwner("overview-support");
    const owner = sessionFor(ownerUser);
    const member = await addTeammate(ownerUser, "overview-support-member", "member");
    const assigned = await openTicket(owner.companyId, "Assigned");
    await openTicket(owner.companyId, "Waiting");
    const closed = await openTicket(owner.companyId, "Closed");
    assert.deepEqual(await assignTicketForSession(owner, { ticketId: assigned, assigneeUserId: member.id }), { ok: true });
    assert.deepEqual(await closeTicketWithoutEmailForSession(owner, { ticketId: closed }), { ok: true });
    const line = await createPhoneLine(owner.companyId, `pn-overview-${runId}`);
    await markDecided(await saveTestCall(line.vapiPhoneNumberId, "User: hi", "+1 555 0611"), "solved");
    await markDecided(await saveTestCall(line.vapiPhoneNumberId, "User: hi", "+1 555 0612"), "needs_human");
    await markDecided(await saveTestCall(line.vapiPhoneNumberId, "User: hi", "+1 555 0613"), "solved", 8);
    await receiveEmailRow(ownerUser, "overview-waiting");
    const stuck = await receiveEmailRow(ownerUser, "overview-stuck");
    await db.update(inboundEmails).set({ status: "processing", processingStartedAt: new Date(Date.now() - 20 * 60 * 1000) }).where(eq(inboundEmails.id, stuck));
    // Another company with tickets, calls and email of its own.
    const otherUser = await signUpTestOwner("overview-support-other");
    await openTicket(otherUser.companyId, "Theirs");
    const otherLine = await createPhoneLine(otherUser.companyId, `pn-overview-other-${runId}`);
    await markDecided(await saveTestCall(otherLine.vapiPhoneNumberId, "User: hi", "+1 555 0614"), "solved");
    await receiveEmailRow(otherUser, "overview-theirs");

    const overview = await getBusinessOverviewForSession(owner);
    assert.deepEqual(overview.support, { openTickets: 2, unassignedTickets: 1, callsLastWeek: 2, callsSolvedByAiLastWeek: 1, emailsWaiting: 1, emailsStuck: 1 });
    const views = await countTicketsPerViewForSession(owner, null);
    assert.deepEqual([overview.support.openTickets, overview.support.unassignedTickets], [views.open, views.unassigned]);
    // A member sees the same company numbers.
    assert.deepEqual((await getBusinessOverviewForSession(sessionFor(member))).support, overview.support);
    assert.deepEqual((await getBusinessOverviewForSession(sessionFor(otherUser))).support, {
      openTickets: 1,
      unassignedTickets: 1,
      callsLastWeek: 1,
      callsSolvedByAiLastWeek: 1,
      emailsWaiting: 1,
      emailsStuck: 0,
    });
  });

  await check("business overview: the Co-Founder half stays one line until the company starts it (a fact, an interview answer or a draft: an owner is invited, a member told an owner starts it); then key facts x of y, drafts waiting for approval, posts scheduled for the next 7 days (one already due and waiting for a run too, each in the queue's Scheduled list the number links to), posts needing attention (a run cut off while sending too) or failed in the last 7 days, and accounts needing a reconnect (one whose access ran out too); another company's never count", async () => {
    const ownerUser = await signUpTestOwner("overview-cofounder");
    const owner = sessionFor(ownerUser);
    const member = sessionFor(await addTeammate(ownerUser, "overview-cofounder-member", "member"));
    const before = await getBusinessOverviewForSession(owner);
    assert.deepEqual([before.cofounder, before.canStartCofounder], [null, true]);
    const beforeForMember = await getBusinessOverviewForSession(member);
    assert.deepEqual([beforeForMember.cofounder, beforeForMember.canStartCofounder], [null, false]);
    // An interview answer alone (the AI unavailable: nothing proposed) starts it.
    const interviewOnly = sessionFor(await signUpTestOwner("overview-interview-only"));
    const unavailable = scriptedModel([{ kind: "unavailable" }]);
    assert.ok((await answerLikeThePage(interviewOnly, "We bake bread.", unavailable.ask)).ok);
    assert.notEqual((await getBusinessOverviewForSession(interviewOnly)).cofounder, null, "an interview answer didn't count as a start");
    // A draft alone starts it too (anyone writes drafts).
    const draftOnly = sessionFor(await signUpTestOwner("overview-draft-only"));
    await blankDraftId(draftOnly);
    assert.notEqual((await getBusinessOverviewForSession(draftOnly)).cofounder, null, "a draft didn't count as a start");

    await typeFact(owner, "company_name", "Bluebird Bakery");
    const first = await approvedDraftOf(owner);
    const drafts = [first];
    for (const topic of ["Second", "Third", "Fourth", "Fifth"]) {
      drafts.push(await anotherApprovedDraft(owner, `${topic} ${runId}`));
    }
    // Written by the AI and not approved: the one waiting for approval. An
    // idea (a blank draft) waits for nothing yet.
    await generatedDraftId(owner, { ...LINKEDIN_POST, topic: `Waiting ${runId}` });
    await blankDraftId(owner, { ...LINKEDIN_POST, topic: `Idea ${runId}` });
    const account = await standInAccount(owner);
    // Within the next 7 days, and after them.
    const [soon] = await scheduledJobIds(owner, drafts[0], [account], inMinutes(60));
    await scheduledJobIds(owner, drafts[1], [account], inMinutes(10 * 24 * 60));
    // Due since yesterday and still waiting for a run (on Vercel Hobby, the
    // daily job's): counted too, so the number's link must list it.
    const [overdue] = await scheduledJobIds(owner, await anotherApprovedDraft(owner, `Overdue ${runId}`), [account], inMinutes(60));
    await db.update(publishJobs).set({ scheduledFor: sql`now() - interval '30 hours'`, runAfter: sql`now() - interval '30 hours'` }).where(eq(publishJobs.id, overdue));
    const [attention] = await scheduledJobIds(owner, drafts[2], [account], inMinutes(60));
    const [cutOff] = await scheduledJobIds(owner, drafts[3], [account], inMinutes(60));
    const [failed] = await scheduledJobIds(owner, drafts[4], [account], inMinutes(60));
    await db.update(publishJobs).set({ status: "needs_attention", lastError: "unclear_answer" }).where(eq(publishJobs.id, attention));
    await db.update(publishJobs).set({ status: "publishing", attempts: 1, claimedAt: sql`now() - interval '11 minutes'` }).where(eq(publishJobs.id, cutOff));
    await db.update(publishJobs).set({ status: "failed", lastError: "token_rejected" }).where(eq(publishJobs.id, failed));
    // A failure from two weeks ago no longer counts.
    const oldDraft = await anotherApprovedDraft(owner, `Old ${runId}`);
    const [oldFailure] = await scheduledJobIds(owner, oldDraft, [account], inMinutes(60));
    await db.update(publishJobs).set({ status: "failed", lastError: "token_rejected", updatedAt: new Date(Date.now() - 14 * DAY_MS) }).where(eq(publishJobs.id, oldFailure));
    // One LinkedIn member whose 60 days ran out, one refused by its platform.
    const ranOut = await realLinkedInAccount(owner, `overview-ran-out-${runId}`);
    await db.update(socialConnections).set({ accessExpiresAt: new Date(Date.now() - 60 * 1000) }).where(eq(socialConnections.id, ranOut));
    const refused = await realLinkedInAccount(owner, `overview-refused-${runId}`);
    await db.update(socialConnections).set({ status: "needs_reauth", lastError: "token_rejected" }).where(eq(socialConnections.id, refused));
    // Another company with drafts and posts of its own.
    const other = sessionFor(await signUpTestOwner("overview-cofounder-other"));
    const theirDraft = await approvedDraftOf(other);
    await scheduledJobIds(other, theirDraft, [await standInAccount(other)], inMinutes(60));

    const overview = await getBusinessOverviewForSession(owner);
    assert.deepEqual(overview.cofounder, {
      keyFactsConfirmed: 4,
      keyFactsTotal: 16,
      draftsWaitingForApproval: 1,
      postsScheduledNextWeek: 2,
      postsNeedingAttention: 2,
      postsFailedLastWeek: 1,
      accountsNeedingReconnect: 2,
    });
    assert.deepEqual((await getBusinessOverviewForSession(member)).cofounder, overview.cofounder, "a member sees other numbers");
    // The number links to the queue's Scheduled list, which shows both (the
    // calendar starts at today, so it would miss the overdue one).
    const waitingIds = (await getQueuePageForSession(owner)).waiting.map((job) => job.id);
    for (const counted of [soon, overdue]) {
      assert.ok(waitingIds.includes(counted), "a post the overview counts as scheduled is not in the queue's Scheduled list");
    }
    const theirs = (await getBusinessOverviewForSession(other)).cofounder;
    assert.deepEqual([theirs?.draftsWaitingForApproval, theirs?.postsScheduledNextWeek, theirs?.postsNeedingAttention, theirs?.accountsNeedingReconnect], [0, 1, 0, 0]);
  });

  await check("business overview: each count reads at most one row past 10,000 (Postgres stops there), shown as '10,000+'; exactly 10,000 shows as it is", async () => {
    const owner = sessionFor(await signUpTestOwner("overview-limit"));
    const many = OVERVIEW_COUNT_LIMIT + 5;
    // Straight into the table: thousands of tickets through the service would take minutes.
    await db.execute(
      sql`insert into tickets (company_id, ticket_number, subject, description, channel) select ${owner.companyId}, n, 'Bulk', 'Made by the overview checks.', 'email' from generate_series(1, ${many}) as n`,
    );
    const { support } = await getBusinessOverviewForSession(owner);
    assert.equal(support.openTickets, OVERVIEW_COUNT_LIMIT + 1);
    assert.equal(support.unassignedTickets, OVERVIEW_COUNT_LIMIT + 1);
    assert.equal(formatOverviewCount(support.openTickets), "10,000+");
    assert.equal(formatOverviewCount(OVERVIEW_COUNT_LIMIT), "10,000");
    assert.equal(formatOverviewCount(1234), "1,234");
    // The ticket list's own count still says how many there are.
    assert.equal((await countTicketsPerViewForSession(owner, null)).open, many);
  });
}
