// Ticket note checks (step 30): a note is saved only on the session's own
// company's ticket (the ticket id is only a claim, checked inside the INSERT),
// written by the session's user, encrypted at rest, and reads back however the
// ticket id was spelled; another company can neither add one nor read the
// history; the text is 1 to 5000 characters (a line break counts once);
// notes count against the ticket-changes limit; a note never reaches an email
// or a log line; the page shows the newest 200 entries, oldest first; and the
// database refuses history rows that cross companies.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/db/client";
import { ticketActivity } from "@/db/schema";
import { addTicketNote, getTicketActivity } from "@/db/ticket-activity";
import { decryptText, encryptText } from "@/lib/encryption";
import { ticketNoteContext } from "@/lib/encryption-contexts";
import { isOverRateLimit, RATE_LIMITS } from "@/services/rate-limit";
import { addTicketNoteForSession, getTicketHistoryForSession, HISTORY_LIMIT } from "@/services/ticket-history";
import { markTicketSolvedForSession } from "@/services/ticket-status";
import { assignTicketForSession, createTicketForCompany, setCustomerEmailForSession } from "@/services/tickets";
import { addTeammate, assertRefusedByConstraint, captureConsole, check, runId, sessionFor, type TestUser } from "./helpers";
import { historyRows } from "./history-helpers";
import { assignmentEmailCount } from "./team-helpers";

function newTicket(subject: string) {
  return { subject, description: "Created by the note checks.", channel: "phone" };
}

// Every email the dev outbox holds, read whole.
async function everyOutboxEmail(): Promise<string[]> {
  const outbox = path.join(process.cwd(), ".dev-emails");
  const files = await readdir(outbox).catch(() => [] as string[]);
  return Promise.all(files.map((file) => readFile(path.join(outbox, file), "utf8")));
}

export async function runTicketNoteChecks(ownerA: TestUser, ownerB: TestUser) {
  const asOwnerA = sessionFor(ownerA);
  const ticketA = await createTicketForCompany(ownerA.companyId, newTicket("Notes A"));

  await check("notes: saved on the company's own ticket, written by the session's user, encrypted at rest", async () => {
    const body = `Called back, promised a refund for order 4411 ${runId}`;
    // A smuggled author or company is ignored: both come from the session.
    const input = { ticketId: ticketA.id, body: `  ${body}\n`, authorUserId: ownerB.id, companyId: ownerB.companyId };
    assert.deepEqual(await addTicketNoteForSession(asOwnerA, input), { ok: true });
    const [row] = await historyRows(ticketA.id);
    assert.deepEqual([row.kind, row.companyId, row.actorUserId, row.targetUserId], ["note", ownerA.companyId, ownerA.id, null]);
    const stored = row.bodyEncrypted ?? "";
    assert.ok(stored.startsWith("v1:") && !stored.includes("refund"), "the note is stored readable");
    assert.equal(decryptText(stored, ticketNoteContext(ownerA.companyId, ticketA.id, row.id)), body);
    // Tied to this company, ticket and note: copied anywhere else it can't be read.
    assert.throws(() => decryptText(stored, ticketNoteContext(ownerB.companyId, ticketA.id, row.id)));
    assert.throws(() => decryptText(stored, ticketNoteContext(ownerA.companyId, randomUUID(), row.id)));
    const { entries } = await getTicketHistoryForSession(asOwnerA, ticketA.id);
    assert.deepEqual(entries.map((entry) => [entry.kind, entry.actorName, entry.noteText]), [["note", "Owner a", body]]);
  });

  await check("notes: a ticket id sent in capitals saves a note that still reads back", async () => {
    const ticket = await createTicketForCompany(ownerA.companyId, newTicket("Notes in capitals"));
    const input = { ticketId: ticket.id.toUpperCase(), body: "Sent with the id in capitals" };
    assert.deepEqual(await addTicketNoteForSession(asOwnerA, input), { ok: true });
    const { entries } = await getTicketHistoryForSession(asOwnerA, ticket.id);
    assert.deepEqual(entries.map((entry) => [entry.noteText, entry.noteUnreadable]), [["Sent with the id in capitals", false]]);
  });

  await check("notes: another company can't add a note to the ticket, nor read its history", async () => {
    const before = (await historyRows(ticketA.id)).length;
    const refused = await addTicketNoteForSession(sessionFor(ownerB), { ticketId: ticketA.id, body: "Not my ticket" });
    assert.deepEqual(refused, { ok: false, errors: { message: "That ticket was not found in your company." } });
    // Straight to /db with B's company: the INSERT ... SELECT finds no ticket.
    const noteId = randomUUID();
    const bodyEncrypted = encryptText("Not my ticket", ticketNoteContext(ownerB.companyId, ticketA.id, noteId));
    assert.equal(await addTicketNote(ownerB.companyId, { noteId, ticketId: ticketA.id, authorUserId: ownerB.id, bodyEncrypted }), false);
    assert.equal((await historyRows(ticketA.id)).length, before, "a row was written");
    assert.deepEqual(await getTicketHistoryForSession(sessionFor(ownerB), ticketA.id), { entries: [], olderEntriesHidden: false });
    assert.deepEqual(await getTicketActivity(ownerB.companyId, ticketA.id, 10), []);
  });

  await check("notes: 1 to 5000 characters after trimming, and they count against the ticket-changes limit", async () => {
    for (const body of ["", "  \n ", "x".repeat(5001)]) {
      const result = await addTicketNoteForSession(asOwnerA, { ticketId: ticketA.id, body });
      assert.ok(!result.ok && result.errors.fieldErrors?.body, `a ${body.length}-character note was accepted`);
    }
    assert.deepEqual(await addTicketNoteForSession(asOwnerA, { ticketId: "not-a-ticket", body: "Hi" }), { ok: false, errors: { message: "Unknown ticket." } });
    assert.deepEqual(await addTicketNoteForSession(asOwnerA, { ticketId: ticketA.id, body: "y".repeat(5000) }), { ok: true });
    // A submitted form sends each line break as \r\n; it counts once, as in
    // the box (5000 here), and is stored as \n.
    const lines = Array.from({ length: 50 }, () => "z".repeat(99));
    assert.deepEqual(await addTicketNoteForSession(asOwnerA, { ticketId: ticketA.id, body: `${lines.join("\r\n")}!` }), { ok: true });
    const { entries } = await getTicketHistoryForSession(asOwnerA, ticketA.id);
    assert.equal(entries.at(-1)?.noteText, `${lines.join("\n")}!`);
    // A teammate of their own, so no other check shares the counter.
    const busy = await addTeammate(ownerA, "notes-busy", "member");
    for (let attempt = 0; attempt < RATE_LIMITS.ticketChangesPerUser.maxAttempts; attempt++) {
      await isOverRateLimit("ticket-changes", busy.id, RATE_LIMITS.ticketChangesPerUser);
    }
    const limited = await addTicketNoteForSession(sessionFor(busy), { ticketId: ticketA.id, body: "One too many" });
    assert.deepEqual(limited, { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } });
  });

  await check("notes: never emailed, never logged", async () => {
    const marker = `note-secret-${runId}`;
    const expert = await addTeammate(ownerA, "notes-expert", "member");
    const ticket = await createTicketForCompany(ownerA.companyId, newTicket("Notes stay inside"));
    const customer = `notes-${runId}@customer.test`;
    const { result, logs } = await captureConsole(async () => {
      const added = await addTicketNoteForSession(asOwnerA, { ticketId: ticket.id, body: `The customer said ${marker}` });
      const { entries } = await getTicketHistoryForSession(asOwnerA, ticket.id);
      // Both emails a ticket can cause: "a ticket is yours" and "solved".
      await assignTicketForSession(asOwnerA, { ticketId: ticket.id, assigneeUserId: expert.id });
      await setCustomerEmailForSession(asOwnerA, { ticketId: ticket.id, customerEmail: customer, confirmed: "yes" });
      await markTicketSolvedForSession(sessionFor(expert), { ticketId: ticket.id, confirmedCustomerEmail: customer });
      return { added, noteTexts: entries.map((entry) => entry.noteText) };
    });
    // Without a saved note, nothing below would prove anything.
    assert.deepEqual(result.added, { ok: true });
    assert.ok(result.noteTexts.some((text) => text?.includes(marker)), "the note was not saved");
    assert.equal(await assignmentEmailCount(ticket.id), 1, "the assignment email was not written");
    assert.ok(logs.every((line) => !line.includes(marker)), "a note reached a log line");
    assert.ok((await everyOutboxEmail()).every((email) => !email.includes(marker)), "a note reached an email");
  });

  await check("history: the page gets the newest 200 entries, oldest first, and is told older ones are hidden", async () => {
    const ticket = await createTicketForCompany(ownerA.companyId, newTicket("Long history"));
    const start = Date.now() - 1_000_000;
    const rows = Array.from({ length: HISTORY_LIMIT + 1 }, (_, index) => ({
      companyId: ownerA.companyId,
      ticketId: ticket.id,
      kind: "category_set" as const,
      actorUserId: ownerA.id,
      createdAt: new Date(start + index * 1000),
    }));
    await db.insert(ticketActivity).values(rows);
    const { entries, olderEntriesHidden } = await getTicketHistoryForSession(asOwnerA, ticket.id);
    assert.equal(olderEntriesHidden, true);
    assert.equal(entries.length, HISTORY_LIMIT);
    assert.equal(entries[0].createdAt.getTime(), start + 1000, "the oldest entry should be the one left out");
    assert.equal(entries[HISTORY_LIMIT - 1].createdAt.getTime(), start + HISTORY_LIMIT * 1000);
  });

  await check("history: the database refuses rows across companies, and note text anywhere but on a note", async () => {
    const row = { companyId: ownerA.companyId, ticketId: ticketA.id, kind: "solved" as const, actorUserId: ownerA.id };
    const refusals: [typeof ticketActivity.$inferInsert, string][] = [
      [{ ...row, companyId: ownerB.companyId, actorUserId: ownerB.id }, "ticket_activity_ticket_in_same_company_fk"],
      [{ ...row, actorUserId: ownerB.id }, "ticket_activity_actor_in_same_company_fk"],
      [{ ...row, kind: "assigned", targetUserId: ownerB.id }, "ticket_activity_target_in_same_company_fk"],
      [{ ...row, bodyEncrypted: "v1:a:b:c" }, "ticket_activity_body_only_on_notes"],
      [{ ...row, kind: "note", actorUserId: null, bodyEncrypted: "v1:a:b:c" }, "ticket_activity_note_has_author"],
    ];
    for (const [values, constraint] of refusals) {
      await assertRefusedByConstraint(db.insert(ticketActivity).values(values), constraint);
    }
  });
}
