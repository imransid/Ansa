// Navigation checks (step 43), on the code itself: the header's sections and
// the Co-Founder's row of links in the order the product uses, both made to
// wrap on a phone rather than scroll sideways, and the dashboard's Business
// overview above the ticket list with every number a link.

import assert from "node:assert/strict";
import { COFOUNDER_PAGES } from "@/lib/cofounder/pages";
import { SIGNED_IN_SECTIONS } from "@/lib/login-redirect";
import { check } from "./helpers";
import { read, withoutComments } from "./source-helpers";

// The labels of one array of links in a source file, in order.
function labelsIn(source: string): string[] {
  return [...source.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);
}

export async function runNavigationChecks() {
  await check("navigation: the header lists Tickets, Calls, Emails, Knowledge, Co-Founder, Team, Setup in that order, with Account and Billing in the 'who you are' row; the Co-Founder's row lists Overview, Interview, Profile, Strategy, Studio, Media, Calendar, Queue, Analytics, Accounts; every one needs a login", async () => {
    const header = withoutComments(await read("components/app-header.tsx"));
    const sectionLinks = header.slice(header.indexOf("const SECTION_LINKS"), header.indexOf("];", header.indexOf("const SECTION_LINKS")));
    assert.deepEqual(labelsIn(sectionLinks), ["Tickets", "Calls", "Emails", "Knowledge", "Co-Founder", "Team", "Setup"]);
    const accountRow = header.slice(header.indexOf('aria-label="Your account"'));
    for (const link of ['href="/account"', 'href="/billing"']) {
      assert.ok(accountRow.includes(link), `the "who you are" row has no ${link}`);
    }
    assert.deepEqual(
      COFOUNDER_PAGES.map((page) => page.label),
      ["Overview", "Interview", "Profile", "Strategy", "Studio", "Media", "Calendar", "Queue", "Analytics", "Accounts"],
    );
    for (const href of [...[...sectionLinks.matchAll(/href: "([^"]+)"/g)].map((match) => match[1]), "/account", "/billing"]) {
      assert.ok(SIGNED_IN_SECTIONS.some((section) => href === section || href.startsWith(`${section}/`)), `${href} doesn't need a login`);
    }
  });

  await check("navigation: on a 360-pixel phone the header and the Co-Founder's row wrap whole words onto more lines instead of scrolling sideways, and the 'who you are' row stays one line, its name cut with '...'", async () => {
    const header = withoutComments(await read("components/app-header.tsx"));
    assert.match(header, /<nav aria-label="Sections" className="[^"]*\bflex-wrap\b/);
    assert.match(header, /function HeaderLink[\s\S]*?"rounded-sm whitespace-nowrap/);
    assert.match(header, /const SIGNED_IN_ROW = "flex h-7 min-w-0 /);
    assert.match(header, /<p className="min-w-0 flex-1 truncate"/);
    assert.match(header, /<nav aria-label="Your account" className="flex shrink-0/);
    const coFounderRow = withoutComments(await read("app/cofounder/sub-navigation.tsx"));
    assert.match(coFounderRow, /<nav aria-label="Co-Founder pages" className="flex flex-wrap/);
    assert.match(coFounderRow, /"rounded-sm whitespace-nowrap/);
  });

  await check("dashboard: the Business overview is the page's h1, above the ticket list (whose heading is an h2), and every number in it is a link to the page that lists it (the posts scheduled for the next 7 days: the queue's Scheduled list)", async () => {
    const page = withoutComments(await read("app/dashboard/page.tsx"));
    const overviewAt = page.indexOf("<BusinessOverviewPanel");
    const ticketsHeadingAt = page.indexOf('<h2 className="text-xl font-semibold">Tickets</h2>');
    assert.ok(overviewAt > 0 && ticketsHeadingAt > overviewAt, "the overview is not above the ticket list");
    assert.ok(!page.includes("<h1"), "the dashboard has a second h1");
    const panel = withoutComments(await read("app/dashboard/business-overview.tsx"));
    assert.equal((panel.match(/<h1\b/g) ?? []).length, 1);
    // Once every link is taken out, no number is left on its own.
    const withoutLinks = panel.replace(/<NumberLink\b[\s\S]*?<\/NumberLink>/g, "");
    for (const number of ["countWithNoun(", "formatOverviewCount(", "keyFactsConfirmed"]) {
      assert.ok(!withoutLinks.includes(number), `a number shown outside a link: ${number}`);
    }
    assert.equal((panel.match(/<NumberLink\b/g) ?? []).length, 12, "a number was added or taken away: list it here");
    // The posts scheduled for the next 7 days (due ones too) open the
    // queue's Scheduled list, which lists due posts; the calendar starts at
    // today and would hide them.
    assert.match(panel, /<NumberLink href="\/cofounder\/queue#queue-waiting">\s*\{`\$\{countWithNoun\(numbers\.postsScheduledNextWeek,/);
    assert.match(withoutComments(await read("app/cofounder/queue/page.tsx")), /<JobSection id="queue-waiting" title=\{`Scheduled /);
  });
}
