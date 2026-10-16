// Pagination checks (step 11): lists split into pages of 50 without losing or
// repeating rows, odd ?page= values fall back to page 1, and no page ever
// shows another company's rows.

import assert from "node:assert/strict";
import { createPhoneLine } from "@/db/phone-lines";
import { PAGE_SIZE, pageCount, parsePageNumber } from "@/lib/pagination";
import { countCallsForSession, listCallsForSession } from "@/services/calls";
import { createTicketForCompany, getTicketCountsForSession, listTicketsForSession } from "@/services/tickets";
import { saveTestCall } from "./brain-test-calls";
import { check, runId, sessionFor, signUpTestOwner, type TestUser } from "./helpers";

export async function runPaginationChecks(ownerB: TestUser) {
  // A fresh company, so we know exactly how many rows it has.
  const pager = await signUpTestOwner("pager");
  const asPager = sessionFor(pager);
  for (let index = 0; index < PAGE_SIZE + 1; index++) {
    await createTicketForCompany(pager.companyId, { subject: `Paged ${index}`, description: "x", channel: "phone" });
  }

  await check("pages: 51 tickets make page 1 (50, newest first) and page 2 (1), no row lost or repeated", async () => {
    const pageOne = await listTicketsForSession(asPager, 1);
    const pageTwo = await listTicketsForSession(asPager, 2);
    const pageThree = await listTicketsForSession(asPager, 3);
    assert.equal(pageOne.length, PAGE_SIZE);
    assert.equal(pageTwo.length, 1);
    assert.equal(pageThree.length, 0);
    assert.equal(pageOne[0].ticketNumber, PAGE_SIZE + 1);
    assert.equal(pageTwo[0].ticketNumber, 1);
    const allNumbers = [...pageOne, ...pageTwo].map((ticket) => ticket.ticketNumber);
    assert.equal(new Set(allNumbers).size, PAGE_SIZE + 1);
    const counts = await getTicketCountsForSession(asPager);
    assert.equal(pageCount(counts.open + counts.solved), 2);
  });

  await check("pages: another company's pages never contain these tickets", async () => {
    const pagerIds = new Set((await listTicketsForSession(asPager, 1)).map((ticket) => ticket.id));
    for (const page of [1, 2, 3]) {
      const otherPage = await listTicketsForSession(sessionFor(ownerB), page);
      assert.ok(!otherPage.some((ticket) => pagerIds.has(ticket.id)), `company B page ${page} leaked a ticket`);
    }
  });

  await check("pages: calls page the same way, newest first", async () => {
    const line = await createPhoneLine(pager.companyId, `pn-pager-${runId}`);
    for (let index = 0; index < PAGE_SIZE + 1; index++) {
      await saveTestCall(line.vapiPhoneNumberId, `User: call number ${index}`);
    }
    assert.equal(await countCallsForSession(asPager), PAGE_SIZE + 1);
    const pageOne = await listCallsForSession(asPager, 1);
    const pageTwo = await listCallsForSession(asPager, 2);
    assert.equal(pageOne.length, PAGE_SIZE);
    assert.equal(pageTwo.length, 1);
    assert.equal(new Set([...pageOne, ...pageTwo].map((call) => call.id)).size, PAGE_SIZE + 1);
    const otherCalls = await listCallsForSession(sessionFor(ownerB), 1);
    assert.ok(!otherCalls.some((call) => pageOne.some((mine) => mine.id === call.id)));
  });

  await check("pages: odd ?page= values fall back to page 1", async () => {
    for (const odd of [undefined, "", "abc", "0", "-2", "1.5", "99999999", ["1", "2"]]) {
      assert.equal(parsePageNumber(odd), 1, `"${odd}" was not page 1`);
    }
    assert.equal(parsePageNumber("2"), 2);
    assert.equal(parsePageNumber(" 3 "), 3);
  });
}
