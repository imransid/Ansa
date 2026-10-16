// Assignment email checks (step 13): whoever a ticket lands on is told, once,
// whatever way it got there; nobody is told about assigning themselves, about
// a ticket that isn't theirs, or about another company's ticket; and the email
// carries no customer contact details or notes.

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { createPhoneLine } from "@/db/phone-lines";
import { tickets } from "@/db/schema";
import { notifyAssignee } from "@/services/assignment-notifications";
import { analyzeCall } from "@/services/call-analysis";
import {
  createCategoryForSession,
  getTeamCategoriesForSession,
  setTicketCategoryForSession,
  setUserCategoriesForSession,
} from "@/services/categories";
import { assignTicketForSession, createTicketForCompany } from "@/services/tickets";
import { answer } from "./brain-guard-checks";
import { fakeModel, saveTestCall } from "./brain-test-calls";
import { addTeammate, captureConsole, check, runId, sessionFor, type TestUser } from "./helpers";

const OUTBOX = path.join(process.cwd(), ".dev-emails");

async function assignmentEmails(ticketId: string): Promise<string[]> {
  const files = (await readdir(OUTBOX).catch(() => [] as string[])).filter((file) => file.includes(`ticket-assigned-${ticketId}-`));
  return Promise.all(files.map((file) => readFile(path.join(OUTBOX, file), "utf8")));
}

export async function runNotificationChecks(ownerA: TestUser, ownerB: TestUser) {
  const asOwnerA = sessionFor(ownerA);
  const expert = await addTeammate(ownerA, "notify-expert", "member");
  await createCategoryForSession(asOwnerA, { name: "Notify" });
  const notifyId = (await getTeamCategoriesForSession(asOwnerA)).categories.find((category) => category.name === "Notify")!.id;
  await setUserCategoriesForSession(sessionFor(expert), { userId: expert.id, categoryIds: [notifyId] });

  await check("notify: routing a new ticket emails the expert once, without customer details", async () => {
    const { result: ticket, logs } = await captureConsole(() =>
      createTicketForCompany(ownerA.companyId, {
        subject: "Printer\r\nBcc: someone@evil.test",
        description: "Secret notes about the customer",
        channel: "phone",
        category: "Notify",
        customerPhone: "+1 555 0199",
        customerEmail: "customer-notify@example.test",
      }),
    );
    assert.equal(ticket.assignedToUserId, expert.id);
    const emails = await assignmentEmails(ticket.id);
    assert.equal(emails.length, 1);
    const email = emails[0];
    assert.ok(email.includes(expert.email) && email.includes(`/tickets/${ticket.ticketNumber}`));
    assert.ok(email.includes("because you handle Notify"));
    for (const secret of ["Secret notes", "+1 555 0199", "customer-notify@example.test"]) {
      assert.ok(!email.includes(secret), `the email contains "${secret}"`);
    }
    assert.ok(!/Subject:<\/strong>[^<]*\r?\n/.test(email), "a line break reached the subject line");
    assert.ok(logs.every((line) => !line.includes(expert.email)), "the address was logged");
  });

  await check("notify: a person's assignment emails the assignee; assigning yourself or unassigning doesn't", async () => {
    const ticket = await createTicketForCompany(ownerA.companyId, { subject: "Manual", description: "x", channel: "phone" });
    await assignTicketForSession(asOwnerA, { ticketId: ticket.id, assigneeUserId: expert.id });
    let emails = await assignmentEmails(ticket.id);
    assert.equal(emails.length, 1);
    assert.ok(emails[0].includes("A teammate assigned it to you."));
    await assignTicketForSession(sessionFor(expert), { ticketId: ticket.id, assigneeUserId: expert.id });
    await assignTicketForSession(asOwnerA, { ticketId: ticket.id, assigneeUserId: "" });
    emails = await assignmentEmails(ticket.id);
    assert.equal(emails.length, 1, "self-assignment or unassigning sent an email");
  });

  await check("notify: setting a category that routes the ticket emails the expert", async () => {
    const ticket = await createTicketForCompany(ownerA.companyId, { subject: "Later category", description: "x", channel: "phone" });
    assert.equal((await assignmentEmails(ticket.id)).length, 0);
    await setTicketCategoryForSession(asOwnerA, { ticketId: ticket.id, category: "Notify" });
    assert.equal((await assignmentEmails(ticket.id)).length, 1);
  });

  await check("notify: a call escalation routed by category emails the expert", async () => {
    const line = await createPhoneLine(ownerA.companyId, `pn-notify-${runId}`);
    const callId = await saveTestCall(line.vapiPhoneNumberId, "User: My printer is broken.\nAI: I'll pass this on.");
    const reply = answer({ outcome: "needs_human", customer_issue: "Printer broken.", resolution_evidence: "", reason: "Needs a technician.", ticket_subject: "Broken printer", category: "Notify" });
    await analyzeCall(ownerA.companyId, callId, fakeModel(reply).ask);
    const [ticket] = await db.select().from(tickets).where(eq(tickets.callId, callId));
    assert.equal(ticket.assignedToUserId, expert.id);
    assert.equal((await assignmentEmails(ticket.id)).length, 1);
  });

  await check("notify: nobody is told about a ticket that isn't theirs or another company's", async () => {
    const ticket = await createTicketForCompany(ownerA.companyId, { subject: "Not yours", description: "x", channel: "phone" });
    await assignTicketForSession(asOwnerA, { ticketId: ticket.id, assigneeUserId: ownerA.id });
    // Asked directly about people who don't have this ticket: nothing is sent.
    await notifyAssignee({ companyId: ownerA.companyId, ticketId: ticket.id, assigneeUserId: expert.id, assignedByUserId: null });
    await notifyAssignee({ companyId: ownerB.companyId, ticketId: ticket.id, assigneeUserId: ownerB.id, assignedByUserId: null });
    await notifyAssignee({ companyId: ownerB.companyId, ticketId: ticket.id, assigneeUserId: ownerA.id, assignedByUserId: null });
    assert.equal((await assignmentEmails(ticket.id)).length, 0);
  });
}
