// Concurrency checks (step 26): every routing in one company waits for the
// company's row lock (the one ticket numbering and team changes take), so two
// category changes at the same moment can't both pick the same "least busy"
// expert, and removing someone who never confirmed (whose open tickets are
// routed again), saving someone's categories and restoring a category (both
// route waiting tickets, step 29) wait for it too; a category archived while someone's
// categories are being saved is never linked; and a received email that
// another run finished first gets no second ticket. Locks are held by open
// transactions; FAKE model only.

import assert from "node:assert/strict";
import { eq, inArray, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db/client";
import { categories, companies, inboundEmails, tickets, userCategories } from "@/db/schema";
import { removeUnconfirmedAccount } from "@/db/unconfirmed-accounts";
import type { InboundEmailContent } from "@/lib/inbound-email";
import {
  createCategoryForSession,
  getTeamCategoriesForSession,
  setCategoryArchivedForSession,
  setTicketCategoryForSession,
  setUserCategoriesForSession,
} from "@/services/categories";
import { processInboundEmail } from "@/services/inbound-email-processing";
import { reopenTicketForSession } from "@/services/ticket-status";
import { createTicketForCompany } from "@/services/tickets";
import { answer } from "./brain-guard-checks";
import { fakeModel } from "./brain-test-calls";
import { addTeammate, check, runId, sessionFor, signUpTestOwner, type TestUser } from "./helpers";
import { forwardingAddressOf, postReceivedEmail, storedInboundEmail } from "./resend-helpers";
import { joinWithoutConfirming } from "./team-helpers";

// Runs `takeLocks` in a transaction and keeps that transaction open, so its
// locks stay held, until the returned release() is called.
export async function holdLocks(takeLocks: (tx: DbTransaction) => Promise<unknown>) {
  let letGo = () => {};
  const released = new Promise<void>((resolve) => {
    letGo = () => resolve();
  });
  let locksTaken = () => {};
  const held = new Promise<void>((resolve) => {
    locksTaken = () => resolve();
  });
  const transaction = db.transaction(async (tx) => {
    await takeLocks(tx);
    locksTaken();
    await released;
  });
  await held;
  return async () => {
    letGo();
    await transaction;
  };
}

// True when `work` has not finished after 300 ms (it is waiting for a lock).
export async function isStillWaiting(work: Promise<unknown>): Promise<boolean> {
  let finished = false;
  const markFinished = () => {
    finished = true;
  };
  work.then(markFinished, markFinished);
  await new Promise((resolve) => setTimeout(resolve, 300));
  return !finished;
}

function lockCompanyRow(owner: TestUser) {
  return (tx: DbTransaction) => tx.select({ id: companies.id }).from(companies).where(eq(companies.id, owner.companyId)).for("no key update");
}

async function categoryIdOf(owner: TestUser, name: string): Promise<string> {
  const found = (await getTeamCategoriesForSession(sessionFor(owner))).categories.find((category) => category.name === name);
  assert.ok(found, `no category ${name}`);
  return found.id;
}

export async function runConcurrencyChecks() {
  const owner = await signUpTestOwner("concurrency");
  const asOwner = sessionFor(owner);
  // Joined in this order, so expert1 wins ties.
  const expert1 = await addTeammate(owner, "concurrency-1", "member");
  const expert2 = await addTeammate(owner, "concurrency-2", "member");
  await createCategoryForSession(asOwner, { name: "Rush" });
  const rushId = await categoryIdOf(owner, "Rush");
  for (const expert of [expert1, expert2]) {
    await setUserCategoriesForSession(sessionFor(expert), { userId: expert.id, categoryIds: [rushId] });
  }

  await check("routing: setting a category and reopening wait for the company's row lock, the one ticket numbering takes", async () => {
    const ticket = await createTicketForCompany(owner.companyId, { subject: "Waits", description: "x", channel: "phone" });
    const release = await holdLocks(lockCompanyRow(owner));
    const categoryChange = setTicketCategoryForSession(asOwner, { ticketId: ticket.id, category: "Rush" });
    const waited = await isStillWaiting(categoryChange);
    await release();
    assert.equal(waited, true, "setting a category did not wait for the lock");
    assert.deepEqual(await categoryChange, { ok: true });

    await db.update(tickets).set({ status: "solved", solvedAt: new Date(), solvedByUserId: owner.id }).where(eq(tickets.id, ticket.id));
    const releaseAgain = await holdLocks(lockCompanyRow(owner));
    const reopen = reopenTicketForSession(asOwner, { ticketId: ticket.id });
    const reopenWaited = await isStillWaiting(reopen);
    await releaseAgain();
    assert.equal(reopenWaited, true, "reopening did not wait for the lock");
    assert.deepEqual(await reopen, { ok: true });
  });

  await check("team: removing someone who never confirmed waits for the company's row lock, then routes their open ticket again", async () => {
    const invitee = await joinWithoutConfirming(owner, "concurrency-unconfirmed");
    // Set straight in the database: since step 23 nobody unconfirmed gets
    // tickets, but an account from before could hold one.
    const ticket = await createTicketForCompany(owner.companyId, { subject: "Left behind", description: "x", channel: "phone" });
    await db.update(tickets).set({ category: "Rush", assignedToUserId: invitee.id, assignedAutomatically: false }).where(eq(tickets.id, ticket.id));
    const release = await holdLocks(lockCompanyRow(owner));
    const removal = removeUnconfirmedAccount(owner.companyId, invitee.id);
    const waited = await isStillWaiting(removal);
    await release();
    assert.equal(waited, true, "removing did not wait for the lock");
    const removed = await removal;
    assert.ok(removed.removed, "the account was not removed");
    assert.deepEqual(removed.routedTickets.map((routed) => routed.ticketId), [ticket.id]);
  });

  await check("routing: two category changes at the same moment go to two different experts", async () => {
    // Nobody has an open ticket now, so both experts look equally free: two
    // routings counting at the same moment would both pick expert1.
    await db.update(tickets).set({ status: "solved", solvedAt: new Date(), solvedByUserId: owner.id }).where(eq(tickets.companyId, owner.companyId));
    const first = await createTicketForCompany(owner.companyId, { subject: "Race 1", description: "x", channel: "phone" });
    const second = await createTicketForCompany(owner.companyId, { subject: "Race 2", description: "x", channel: "phone" });
    await Promise.all([
      setTicketCategoryForSession(asOwner, { ticketId: first.id, category: "Rush" }),
      setTicketCategoryForSession(asOwner, { ticketId: second.id, category: "Rush" }),
    ]);
    const routed = await db.select({ assignee: tickets.assignedToUserId }).from(tickets).where(inArray(tickets.id, [first.id, second.id]));
    const assignees = routed.map((row) => row.assignee).sort();
    assert.deepEqual(assignees, [expert1.id, expert2.id].sort(), "both went to the same expert, or one was not routed");
  });

  await check("routing: saving someone's categories and restoring a category wait for the company's row lock (both route waiting tickets)", async () => {
    const release = await holdLocks(lockCompanyRow(owner));
    const saving = setUserCategoriesForSession(sessionFor(expert2), { userId: expert2.id, categoryIds: [rushId] });
    const savingWaited = await isStillWaiting(saving);
    await release();
    assert.equal(savingWaited, true, "saving categories did not wait for the lock");
    assert.deepEqual(await saving, { ok: true });

    await createCategoryForSession(asOwner, { name: "Restoring" });
    const restoringId = await categoryIdOf(owner, "Restoring");
    assert.deepEqual(await setCategoryArchivedForSession(asOwner, { categoryId: restoringId, archived: "true" }), { ok: true });
    const releaseAgain = await holdLocks(lockCompanyRow(owner));
    const restoring = setCategoryArchivedForSession(asOwner, { categoryId: restoringId, archived: "false" });
    const restoreWaited = await isStillWaiting(restoring);
    await releaseAgain();
    assert.equal(restoreWaited, true, "restoring did not wait for the lock");
    assert.deepEqual(await restoring, { ok: true });
  });

  await check("categories: one archived while someone's categories are being saved is never linked", async () => {
    await createCategoryForSession(asOwner, { name: "Archiving" });
    const archivingId = await categoryIdOf(owner, "Archiving");
    // An owner's archive, saved but not yet committed.
    const commitArchive = await holdLocks((tx) => tx.update(categories).set({ archivedAt: sql`now()` }).where(eq(categories.id, archivingId)));
    const saving = setUserCategoriesForSession(sessionFor(expert1), { userId: expert1.id, categoryIds: [rushId, archivingId] });
    const waited = await isStillWaiting(saving);
    await commitArchive();
    assert.equal(waited, true, "saving did not wait for the archive");
    assert.equal((await saving).ok, false);
    const links = await db.select().from(userCategories).where(eq(userCategories.userId, expert1.id));
    assert.deepEqual(links.map((link) => link.categoryId), [rushId], "the archived category was linked, or Rush was lost");
  });

  await check("received email: when another run finished it first, this run makes no ticket", async () => {
    const resendId = `second-run-${runId}`;
    await postReceivedEmail(resendId, { to: [await forwardingAddressOf(owner)] });
    const row = await storedInboundEmail(resendId);
    const content: InboundEmailContent = { from: `Pat <pat-${runId}@customer.test>`, to: [], subject: "Help", text: "Hi", headers: {}, authentication: null };
    // While this run waits for the content, another run gives up on the email.
    const fetchEmail = async () => {
      await db.update(inboundEmails).set({ status: "ignored", ignoredReason: "processing_error" }).where(eq(inboundEmails.id, row.id));
      return content;
    };
    const model = fakeModel(answer({ customer_issue: "Needs help.", ticket_subject: "Help", category: "" }));
    const ticketsBefore = (await db.select().from(tickets).where(eq(tickets.companyId, owner.companyId))).length;
    assert.equal(await processInboundEmail(owner.companyId, row.id, { fetchEmail, askModel: model.ask }), "not-claimed");
    assert.equal((await db.select().from(tickets).where(eq(tickets.companyId, owner.companyId))).length, ticketsBefore);
    assert.deepEqual([(await storedInboundEmail(resendId)).status, (await storedInboundEmail(resendId)).ticketId], ["ignored", null]);
  });
}
