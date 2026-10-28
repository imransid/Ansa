// Ticket queue checks (step 29): the dashboard's views (open, mine,
// unassigned, solved, all) and search list and count only the session
// company's tickets, and each view's count matches its list; "mine" always
// means the session's own user, whatever the URL holds; search text is
// matched literally (%, _ and \ are not wildcards); odd URL values fall back
// to the defaults.

import assert from "node:assert/strict";
import { defaultTicketViewFor, parseTicketListQuery, ticketViews, type TicketListQuery, type TicketView } from "@/lib/validation/list-queries";
import { markTicketSolvedForSession } from "@/services/ticket-status";
import { assignTicketForSession, countTicketsPerViewForSession, createTicketForCompany, listTicketsForSession } from "@/services/tickets";
import { addTeammate, check, runId, sessionFor, signUpTestOwner, type TestUser } from "./helpers";
import { receiveAndProcess, resendContent, senderFor } from "./inbound-helpers";

type NewTicket = { subject: string; customerName?: string; customerEmail?: string; customerPhone?: string };

function createFor(owner: TestUser, ticket: NewTicket) {
  return createTicketForCompany(owner.companyId, { description: "x", channel: "phone", ...ticket });
}

// The ticket numbers one person sees in one view (first page), smallest first.
async function listedNumbers(user: TestUser, view: TicketView, search: string | null = null): Promise<number[]> {
  const listed = await listTicketsForSession(sessionFor(user), 1, { view, search });
  return listed.map((ticket) => ticket.ticketNumber).sort((first, second) => first - second);
}

export async function runTicketQueueChecks() {
  const owner = await signUpTestOwner("queue");
  const member = await addTeammate(owner, "queue-member", "member");
  const asOwner = sessionFor(owner);
  // #1 and #5 are the member's, #2 the owner's, #3 nobody's, #4 solved.
  const printer = await createFor(owner, { subject: "Printer jam", customerEmail: `pat.queue-${runId}@customer.test` });
  const refund = await createFor(owner, { subject: "Refund: 100% paid already" });
  const underscore = await createFor(owner, { subject: "Name has an under_score", customerName: "Jordan Queuewell" });
  const backslash = await createFor(owner, { subject: "Path back\\slash broken" });
  const login = await createFor(owner, { subject: "Login trouble", customerPhone: "+15550100199" });
  await assignTicketForSession(asOwner, { ticketId: printer.id, assigneeUserId: member.id });
  await assignTicketForSession(asOwner, { ticketId: login.id, assigneeUserId: member.id });
  await assignTicketForSession(asOwner, { ticketId: refund.id, assigneeUserId: owner.id });
  await markTicketSolvedForSession(asOwner, { ticketId: backslash.id, confirmedCustomerEmail: "" });
  const [n1, n2, n3, n4, n5] = [printer, refund, underscore, backslash, login].map((ticket) => ticket.ticketNumber);

  await check("queue: each view lists only its tickets, and 'mine' is each person's own open tickets", async () => {
    assert.deepEqual(await listedNumbers(owner, "open"), [n1, n2, n3, n5]);
    assert.deepEqual(await listedNumbers(member, "mine"), [n1, n5]);
    assert.deepEqual(await listedNumbers(owner, "mine"), [n2]);
    assert.deepEqual(await listedNumbers(owner, "unassigned"), [n3]);
    assert.deepEqual(await listedNumbers(owner, "solved"), [n4]);
    assert.deepEqual(await listedNumbers(owner, "all"), [n1, n2, n3, n4, n5]);
  });

  await check("queue: every view link's count matches the list it opens, with and without a search", async () => {
    for (const search of [null, "e"]) {
      const counts = await countTicketsPerViewForSession(sessionFor(member), search);
      for (const view of ticketViews) {
        assert.equal(counts[view], (await listedNumbers(member, view, search)).length, `${view} with search ${search}`);
      }
    }
    assert.deepEqual(await countTicketsPerViewForSession(sessionFor(member)), { open: 4, mine: 2, unassigned: 1, solved: 1, all: 5 });
  });

  await check("queue: 'mine' can't be pointed at someone else: the URL carries no user, and a smuggled one is ignored", async () => {
    const fromUrl = parseTicketListQuery({ view: "mine", userId: member.id, assignee: member.id, viewerUserId: member.id } as never, "open");
    assert.deepEqual(fromUrl, { view: "mine", search: null });
    const smuggled = { view: "mine", search: null, viewerUserId: member.id } as TicketListQuery;
    const ownersMine = await listTicketsForSession(asOwner, 1, smuggled);
    assert.deepEqual(ownersMine.map((ticket) => ticket.ticketNumber), [n2]);
  });

  await check("queue: views, searches and counts never cross companies", async () => {
    const other = await signUpTestOwner("queue-other");
    const lookAlike = await createFor(other, { subject: "Printer jam", customerEmail: `pat.queue-${runId}@customer.test` });
    await assignTicketForSession(sessionFor(other), { ticketId: lookAlike.id, assigneeUserId: other.id });
    const ourIds = new Set([printer, refund, underscore, backslash, login].map((ticket) => ticket.id));
    for (const view of ticketViews) {
      for (const search of [null, "Printer", `pat.queue-${runId}`, String(n1)]) {
        const theirs = await listTicketsForSession(sessionFor(other), 1, { view, search });
        assert.ok(!theirs.some((ticket) => ourIds.has(ticket.id)), `the other company saw our ticket in ${view} / ${search}`);
        const ours = await listTicketsForSession(asOwner, 1, { view, search });
        assert.ok(!ours.some((ticket) => ticket.id === lookAlike.id), `we saw the other company's ticket in ${view} / ${search}`);
      }
    }
    assert.deepEqual(await countTicketsPerViewForSession(sessionFor(other), "Printer"), { open: 1, mine: 1, unassigned: 0, solved: 0, all: 1 });
  });

  await check("search: %, _ and \\ match themselves, never as wildcards", async () => {
    assert.deepEqual(await listedNumbers(owner, "all", "%"), [n2]);
    assert.deepEqual(await listedNumbers(owner, "all", "100%"), [n2]);
    assert.deepEqual(await listedNumbers(owner, "all", "_"), [n3]);
    assert.deepEqual(await listedNumbers(owner, "all", "\\"), [n4]);
    assert.deepEqual(await listedNumbers(owner, "all", "nothing like this"), []);
  });

  await check("search: finds a ticket by number, subject, customer name, email or phone however it is written", async () => {
    assert.ok((await listedNumbers(owner, "all", `#${n3}`)).includes(n3));
    assert.ok((await listedNumbers(owner, "all", String(n3))).includes(n3));
    assert.deepEqual(await listedNumbers(owner, "all", "PRINTER"), [n1]);
    assert.deepEqual(await listedNumbers(owner, "all", "jordan queuewell"), [n3]);
    assert.deepEqual(await listedNumbers(owner, "all", `PAT.QUEUE-${runId}@CUSTOMER`), [n1]);
    assert.deepEqual(await listedNumbers(owner, "all", "+1 (555) 010-0199"), [n5]);
    assert.deepEqual(await listedNumbers(owner, "open", "Printer"), [n1], "the search applies within a view too");
    assert.deepEqual(await listedNumbers(owner, "solved", "Printer"), []);
  });

  await check("search: an email ticket whose sender wasn't verified is found by the address it came from, only in its company", async () => {
    // The same unverified sender writes to two companies.
    const content = resendContent("queue-unverified", { authentication: null });
    const ours = (await receiveAndProcess(owner, "queue-unverified", content)).ticket;
    const other = await signUpTestOwner("queue-unverified-other");
    const theirs = (await receiveAndProcess(other, "queue-unverified-other", content)).ticket;
    assert.ok(ours && theirs, "an email made no ticket");
    assert.equal(ours.customerEmail, null, "an unverified sender was filled in as the customer");
    assert.deepEqual(await listedNumbers(owner, "all", senderFor("queue-unverified")), [ours.ticketNumber]);
    const theirList = await listTicketsForSession(sessionFor(other), 1, { view: "all", search: senderFor("queue-unverified") });
    assert.deepEqual(theirList.map((ticket) => ticket.id), [theirs.id]);
  });

  await check("queue: odd ?view= and ?q= values fall back to the defaults; members land on 'mine', owners on 'open'", async () => {
    assert.equal(defaultTicketViewFor("member"), "mine");
    assert.equal(defaultTicketViewFor("owner"), "open");
    for (const odd of [undefined, "", "everything", "MINE", ["open", "solved"]]) {
      assert.deepEqual(parseTicketListQuery({ view: odd }, "mine"), { view: "mine", search: null }, `view ${JSON.stringify(odd)}`);
    }
    assert.deepEqual(parseTicketListQuery({ view: "solved", q: "  refund  " }, "mine"), { view: "solved", search: "refund" });
    for (const odd of ["", "   ", "x".repeat(101), ["a", "b"], "a\u0000b", "line\nbreak"]) {
      assert.equal(parseTicketListQuery({ q: odd }, "open").search, null, `q ${JSON.stringify(odd)}`);
    }
    assert.equal(parseTicketListQuery({ q: "x".repeat(100) }, "open").search, "x".repeat(100));
  });
}
