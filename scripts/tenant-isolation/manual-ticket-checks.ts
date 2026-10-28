// Manual ticket checks (step 31): a ticket a teammate types in lands in their
// own company as "manual", with a "created" history row naming them, and is
// routed (by category, or to whoever has the same customer's open ticket) and
// its assignee emailed like any other new ticket. Nothing in the form chooses
// the company, number, status, channel or assignee; another company's (or an
// archived) category id gives no category; a typed customer email needs the
// confirm step and records who entered it; bad input saves nothing; and the
// creation limit stops a flood, per person.

import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { companies, tickets } from "@/db/schema";
import { describeTicketActivity, historyNamesItsCreator } from "@/lib/ticket-history-text";
import { setCategoryArchivedForSession, setUserCategoriesForSession } from "@/services/categories";
import { createManualTicketForSession, type CreatedTicketResult } from "@/services/manual-tickets";
import { isOverRateLimit, RATE_LIMITS } from "@/services/rate-limit";
import { getTicketHistoryForSession } from "@/services/ticket-history";
import { assignTicketForSession, getTicketForSession, listTicketsForSession } from "@/services/tickets";
import { addTeammate, check, runId, sessionFor, signUpTestOwner, type TestUser } from "./helpers";
import { historySummary } from "./history-helpers";
import { addCategory, assignmentEmailCount } from "./team-helpers";

const BILLING = "Manual billing";

// What the "New ticket" form sends, with its blank boxes as "".
function form(fields: Record<string, unknown> = {}) {
  return {
    subject: `Walk-in ${runId}`,
    description: "Customer at the counter: the invoice shows the wrong address.",
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    categoryId: "",
    customerEmailConfirmed: null,
    ...fields,
  };
}

function ticketNumberOf(result: CreatedTicketResult): number {
  assert.ok(result.ok, `refused: ${JSON.stringify(result)}`);
  return result.ticketNumber;
}

async function storedTicketByNumber(user: TestUser, ticketNumber: number) {
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.companyId, user.companyId), eq(tickets.ticketNumber, ticketNumber)));
  assert.ok(ticket, `no ticket #${ticketNumber}`);
  return ticket;
}

async function lastTicketNumberOf(user: TestUser): Promise<number> {
  const [company] = await db.select({ last: companies.lastTicketNumber }).from(companies).where(eq(companies.id, user.companyId));
  return company.last;
}

export async function runManualTicketChecks() {
  const owner = await signUpTestOwner("manual");
  const member = await addTeammate(owner, "manual-member", "member");
  const expert = await addTeammate(owner, "manual-expert", "member");
  const asMember = sessionFor(member);
  const billingId = await addCategory(owner, BILLING);
  await setUserCategoriesForSession(sessionFor(expert), { userId: expert.id, categoryIds: [billingId] });
  const other = await signUpTestOwner("manual-other");

  await check("manual tickets: a teammate's ticket is saved in their company as 'manual', created by them, routed by category, and the expert emailed", async () => {
    const ticketNumber = ticketNumberOf(await createManualTicketForSession(asMember, form({ categoryId: billingId, customerPhone: "+1 555 0310 001" })));
    const ticket = await storedTicketByNumber(owner, ticketNumber);
    assert.deepEqual(
      [ticket.companyId, ticket.channel, ticket.status, ticket.category, ticket.assignedToUserId, ticket.assignedAutomatically],
      [owner.companyId, "manual", "open", BILLING, expert.id, true],
    );
    assert.deepEqual(await historySummary(ticket.id), [
      ["created", member.id, null, null],
      ["routed", null, expert.id, BILLING],
    ]);
    assert.equal(await assignmentEmailCount(ticket.id), 1);
    // The page shows who created it instead of its own "Ticket created" line.
    const { entries } = await getTicketHistoryForSession(sessionFor(owner), ticket.id);
    assert.equal(describeTicketActivity(entries[0]), "Invited created the ticket");
    assert.equal(historyNamesItsCreator(entries.map((entry) => entry.kind)), true);
  });

  await check("manual tickets: nothing in the form chooses the company, number, status, channel, assignee or who entered the email", async () => {
    const before = await lastTicketNumberOf(owner);
    const smuggled = form({
      companyId: other.companyId,
      ticketNumber: 999_999,
      status: "solved",
      channel: "email",
      assignedToUserId: member.id,
      customerEmailSetByUserId: other.id,
    });
    const ticketNumber = ticketNumberOf(await createManualTicketForSession(asMember, smuggled));
    assert.equal(ticketNumber, before + 1);
    const ticket = await storedTicketByNumber(owner, ticketNumber);
    assert.deepEqual(
      [ticket.companyId, ticket.status, ticket.channel, ticket.assignedToUserId, ticket.customerEmailSetByUserId],
      [owner.companyId, "open", "manual", null, null],
    );
    assert.deepEqual(await listTicketsForSession(sessionFor(other)), [], "a ticket showed up in the other company");
  });

  await check("manual tickets: another company's category, or one archived, gives no category and routes to nobody", async () => {
    const otherCategoryId = await addCategory(other, "Manual other billing");
    const archivedId = await addCategory(owner, "Manual archived");
    await setUserCategoriesForSession(sessionFor(expert), { userId: expert.id, categoryIds: [billingId, archivedId] });
    assert.deepEqual(await setCategoryArchivedForSession(sessionFor(owner), { categoryId: archivedId, archived: "true" }), { ok: true });
    for (const categoryId of [otherCategoryId, archivedId]) {
      const ticket = await storedTicketByNumber(owner, ticketNumberOf(await createManualTicketForSession(asMember, form({ categoryId }))));
      assert.deepEqual([ticket.category, ticket.assignedToUserId], [null, null]);
      assert.deepEqual(await historySummary(ticket.id), [["created", member.id, null, null]]);
    }
  });

  await check("manual tickets: a customer email is saved only after the confirm step, cleaned up, and recorded as entered by its creator", async () => {
    const before = await lastTicketNumberOf(owner);
    const unconfirmed = await createManualTicketForSession(asMember, form({ customerEmail: "Walk.In@Example.TEST" }));
    assert.deepEqual(unconfirmed, { ok: false, errors: { fieldErrors: { customerEmail: ["Confirm the address before saving"] } } });
    assert.equal(await lastTicketNumberOf(owner), before, "an unconfirmed address was saved");
    const confirmed = form({ customerEmail: "Walk.In@Example.TEST", customerEmailConfirmed: "yes" });
    const ticketNumber = ticketNumberOf(await createManualTicketForSession(asMember, confirmed));
    const ticket = await storedTicketByNumber(owner, ticketNumber);
    assert.deepEqual([ticket.customerEmail, ticket.customerEmailSetByUserId], ["walk.in@example.test", member.id]);
    assert.ok(ticket.customerEmailSetAt, "no time for who entered the address");
    assert.equal((await getTicketForSession(sessionFor(owner), ticketNumber))?.customerEmailSetByName, "Invited");
  });

  await check("manual tickets: bad input is refused field by field and saves nothing", async () => {
    const before = await lastTicketNumberOf(owner);
    const refusals: [Record<string, unknown>, string][] = [
      [{ subject: "   " }, "subject"],
      [{ subject: "x".repeat(201) }, "subject"],
      [{ description: "" }, "description"],
      [{ description: "x".repeat(10_001) }, "description"],
      [{ customerName: "x".repeat(201) }, "customerName"],
      [{ customerEmail: "not-an-address", customerEmailConfirmed: "yes" }, "customerEmail"],
      [{ customerPhone: "1".repeat(41) }, "customerPhone"],
      [{ categoryId: "not-a-category-id" }, "categoryId"],
    ];
    for (const [fields, field] of refusals) {
      const result = await createManualTicketForSession(asMember, form(fields));
      assert.ok(!result.ok && result.errors.fieldErrors?.[field], `${JSON.stringify(fields)} was not refused on ${field}`);
    }
    assert.equal(await lastTicketNumberOf(owner), before);
  });

  await check("manual tickets: the same customer's open ticket decides the assignee, as for any new ticket", async () => {
    const phone = "+1 555 0310 002";
    const first = await storedTicketByNumber(owner, ticketNumberOf(await createManualTicketForSession(asMember, form({ categoryId: billingId, customerPhone: phone }))));
    assert.deepEqual(await assignTicketForSession(sessionFor(owner), { ticketId: first.id, assigneeUserId: member.id }), { ok: true });
    const second = await storedTicketByNumber(owner, ticketNumberOf(await createManualTicketForSession(sessionFor(owner), form({ customerPhone: phone }))));
    assert.deepEqual([second.assignedToUserId, second.assignedAutomatically], [member.id, true]);
    assert.deepEqual(await historySummary(second.id), [
      ["created", owner.id, null, null],
      ["routed", null, member.id, null],
    ]);
  });

  await check("manual tickets: the creation limit stops one person's flood, not their teammates", async () => {
    const flooder = await addTeammate(owner, "manual-flooder", "member");
    for (let attempt = 0; attempt < RATE_LIMITS.ticketCreationsPerUser.maxAttempts; attempt++) {
      await isOverRateLimit("ticket-creations", flooder.id, RATE_LIMITS.ticketCreationsPerUser);
    }
    const before = await lastTicketNumberOf(owner);
    const refused = await createManualTicketForSession(sessionFor(flooder), form());
    assert.deepEqual(refused, { ok: false, errors: { message: "Too many new tickets. Try again in a few minutes." } });
    assert.equal(await lastTicketNumberOf(owner), before);
    assert.equal((await createManualTicketForSession(asMember, form())).ok, true);
  });
}
