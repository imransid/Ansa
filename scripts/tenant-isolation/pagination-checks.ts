// Pagination checks (step 11): lists split into pages of 50 without losing or
// repeating rows, odd ?page= values fall back to page 1, and no page ever
// shows another company's rows. Step 29: "Next" never points past the last
// page that can open (so it never starts the list over at page 1), and the
// links keep the list's filters.

import assert from "node:assert/strict";
import { createPhoneLine } from "@/db/phone-lines";
import { buildListUrl, MAX_PAGE, PAGE_SIZE, pageCount, pageLinksFor, parsePageNumber } from "@/lib/pagination";
import { countCallsPerOutcomeForSession, listCallsForSession } from "@/services/calls";
import { countTicketsPerViewForSession, createTicketForCompany, listTicketsForSession } from "@/services/tickets";
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
    const counts = await countTicketsPerViewForSession(asPager);
    assert.equal(pageCount(counts.all), 2);
    const openPageTwo = await listTicketsForSession(asPager, 2, { view: "open", search: null });
    assert.deepEqual(openPageTwo.map((ticket) => ticket.ticketNumber), [1], "a view pages the same way");
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
    assert.equal((await countCallsPerOutcomeForSession(asPager)).all, PAGE_SIZE + 1);
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

  await check("pages: Next never points past page 10,000, where the list would quietly start over at page 1", async () => {
    const rowsPastTheCap = MAX_PAGE * PAGE_SIZE + 50;
    const atTheCap = pageLinksFor(MAX_PAGE, rowsPastTheCap);
    assert.deepEqual(atTheCap, { previousPage: MAX_PAGE - 1, nextPage: null, lastPage: MAX_PAGE, isCut: true });
    assert.equal(parsePageNumber(String(MAX_PAGE)), MAX_PAGE, "the last reachable page opens");
    assert.deepEqual(pageLinksFor(1, PAGE_SIZE + 1), { previousPage: null, nextPage: 2, lastPage: 2, isCut: false });
    // Past the end (a list that shrank): Previous leads back to its last page.
    assert.deepEqual(pageLinksFor(7, PAGE_SIZE + 1), { previousPage: 2, nextPage: null, lastPage: 2, isCut: false });
  });

  await check("pages: Previous, Next and the view links keep the list's filters, encoded", async () => {
    assert.equal(buildListUrl("/dashboard", { view: "open", q: "a&b c#1", page: 2 }), "/dashboard?view=open&q=a%26b+c%231&page=2");
    assert.equal(buildListUrl("/calls", { outcome: "stuck", q: null, page: 3 }), "/calls?outcome=stuck&page=3");
    assert.equal(buildListUrl("/dashboard", { view: undefined, q: "" }), "/dashboard");
  });
}
