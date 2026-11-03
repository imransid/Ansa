// Navigation checks (step 43, redone in step 44), on the code itself: the
// sidebar's sections in the order the product uses, each section's layout
// naming its own, every page still reachable, the phone's bottom bar, and
// Home's Business overview with every number a link.

import assert from "node:assert/strict";
import { COFOUNDER_PAGES } from "@/lib/cofounder/pages";
import { briefingSentence } from "@/lib/home-briefing";
import { SIGNED_IN_SECTIONS } from "@/lib/login-redirect";
import { check } from "./check";
import { read, withoutComments } from "./source-helpers";

// The values of one field in an array of links in a source file, in order.
function fieldIn(source: string, field: "label" | "href" | "section"): string[] {
  return [...source.matchAll(new RegExp(`${field}: "([^"]+)"`, "g"))].map((match) => match[1]);
}

// The section each signed-in folder's layout.tsx must name in AppFrame.
const SECTION_OF_FOLDER: Record<string, string> = {
  dashboard: "home",
  inbox: "inbox",
  orders: "orders",
  tickets: "inbox",
  calls: "inbox",
  emails: "inbox",
  cofounder: "settings",
  knowledge: "settings",
  team: "settings",
  setup: "settings",
  billing: "settings",
  account: "settings",
  settings: "settings",
};

// Signed-in folders with no sidebar on purpose: the restaurant setup (step
// 45), one thing to do step by step.
const FRAMELESS_FOLDERS = ["welcome"];

export async function runNavigationChecks() {
  await check("navigation: the sidebar and the phone's bar list Home, Inbox and Settings in that order, each needing a login; every signed-in section's layout names its section; Settings and the Inbox link every page the sidebar doesn't, and the marketing pages are linked from Social media posts and the Marketing planner", async () => {
    const links = withoutComments(await read("components/section-links.tsx"));
    const sections = links.slice(links.indexOf("export const APP_SECTIONS"), links.indexOf("];", links.indexOf("export const APP_SECTIONS")));
    assert.deepEqual(fieldIn(sections, "label"), ["Home", "Inbox", "Settings"]);
    assert.deepEqual(fieldIn(sections, "href"), ["/dashboard", "/inbox", "/settings"]);
    for (const href of fieldIn(sections, "href")) {
      assert.ok(SIGNED_IN_SECTIONS.some((section) => href === section || href.startsWith(`${section}/`)), `${href} doesn't need a login`);
    }
    // Every signed-in folder has a layout, and it names the right section.
    assert.deepEqual([...Object.keys(SECTION_OF_FOLDER), ...FRAMELESS_FOLDERS].sort(), SIGNED_IN_SECTIONS.map((section) => section.slice(1)).sort());
    for (const folder of FRAMELESS_FOLDERS) {
      const layout = withoutComments(await read(`app/${folder}/layout.tsx`));
      assert.ok(!layout.includes("AppFrame") && layout.includes("<BrandMark") && layout.includes("<PageErrorBoundary>"), `app/${folder}/layout.tsx`);
    }
    for (const [folder, section] of Object.entries(SECTION_OF_FOLDER)) {
      const layout = withoutComments(await read(`app/${folder}/layout.tsx`));
      assert.match(layout, new RegExp(`<AppFrame section="${section}">`), `app/${folder}/layout.tsx doesn't name ${section}`);
    }
    // Pages the sidebar doesn't link are one click away.
    const settings = withoutComments(await read("app/settings/page.tsx"));
    for (const href of ["/setup", "/knowledge", "/cofounder/studio", "/cofounder/accounts", "/team", "/account", "/billing"]) {
      assert.ok(settings.includes(`href: "${href}"`), `Settings doesn't link ${href}`);
    }
    // Step 58: no "Older pages". Social media posts links its media library,
    // its scheduled posts and the Marketing planner, which lists every
    // marketing page: each one is reachable on a phone.
    assert.ok(!settings.includes("Older pages") && !settings.includes("COFOUNDER_PAGES"), "Settings still folds the older pages away");
    const studioLinks = withoutComments(await read("app/cofounder/studio/studio-links.tsx"));
    assert.match(studioLinks, /const NEXT_SEGMENTS: \(string \| null\)\[\] = \["media", "queue", null\];/);
    assert.match(withoutComments(await read("app/cofounder/studio/page.tsx")), /<StudioLinks \/>/);
    const plannerPages = withoutComments(await read("app/cofounder/planner-pages.tsx"));
    assert.match(plannerPages, /const PAGES = COFOUNDER_PAGES\.filter\(\(page\) => page\.segment !== null\);/);
    assert.match(withoutComments(await read("app/cofounder/page.tsx")), /<PlannerPages \/>/);
    for (const segment of ["interview", "profile", "strategy", "studio", "media", "calendar", "queue", "analytics", "accounts"]) {
      assert.ok(COFOUNDER_PAGES.some((page) => page.segment === segment && page.href === `/cofounder/${segment}` && page.description.length > 0), `the planner doesn't list ${segment}`);
    }
    const inbox = withoutComments(await read("app/inbox/page.tsx"));
    for (const href of ["/calls", "/emails", "/inbox/comments", "/tickets/new"]) {
      assert.ok(inbox.includes(`href="${href}"`), `the Inbox doesn't link ${href}`);
    }
  });

  await check("navigation: on a phone the sidebar hides and a bar floating at the bottom shows the same links, side by side, each label on one line and at least 44 pixels tall; the page is padded so the bar never covers its end; Settings has Log out (a phone has no sidebar); the sidebar's 'who you are' keeps one height, its names cut with '...'", async () => {
    const navigation = withoutComments(await read("components/app-navigation.tsx"));
    assert.match(navigation, /<div className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col[^"]*\bmd:flex\b/);
    assert.match(navigation, /<nav\s+aria-label="Sections"\s+className="fixed inset-x-3 bottom-\[calc\(0\.75rem\+env\(safe-area-inset-bottom\)\)\] [^"]*\bmd:hidden\b/);
    assert.match(navigation, /const SIGNED_IN_USER = "grid h-36 /);
    assert.equal((navigation.match(/className="truncate/g) ?? []).length, 2);
    const links = withoutComments(await read("components/section-links.tsx"));
    assert.match(links, /placement === "sidebar" \? "grid gap-1" : "grid auto-cols-fr grid-flow-col"/);
    // Orders (step 52) sits after the Inbox, for a business that takes orders.
    assert.match(links, /export const ORDERS_SECTION: SectionLink = \{ section: "orders", href: "\/orders", label: "Orders"/);
    assert.match(links, /\[APP_SECTIONS\[0\], APP_SECTIONS\[1\], ORDERS_SECTION, APP_SECTIONS\[2\]\]/);
    assert.match(links, /function bottomBarLinkClass[\s\S]*?"flex min-h-14 [^"]*whitespace-nowrap/);
    const frame = withoutComments(await read("components/app-frame.tsx"));
    // The bar is 56 pixels tall and floats 12 above the screen's edge: 88 in all.
    assert.match(frame, /pb-\[calc\(5\.5rem\+env\(safe-area-inset-bottom\)\)\] [^"]*\bmd:pb-0\b/);
    assert.match(withoutComments(await read("app/settings/page.tsx")), /<form action=\{logoutAction\}>/);
  });

  await check("home: its h1 comes first, then what ansa does right now; 'Needs you' and a business's numbers are h2s with every number a link to the page that lists it (tickets: the Inbox's views; the posts scheduled for the next 7 days: the queue's Scheduled list); the ticket list is the Inbox's", async () => {
    const page = withoutComments(await read("app/dashboard/page.tsx"));
    const headingAt = page.indexOf("<h1");
    assert.ok(headingAt > 0 && headingAt < page.indexOf("<StatusCard") && headingAt < page.indexOf("<NeedsYou") && headingAt < page.indexOf("<BusinessOverviewPanel"), "Home's h1 isn't first");
    assert.ok(page.indexOf("<StatusCard") < page.indexOf("<NeedsYou"), "what ansa does comes first");
    assert.equal((page.match(/<h1\b/g) ?? []).length, 1);
    assert.ok(!page.includes("TicketTable"), "Home still lists tickets");
    const panel = withoutComments(
      (await read("app/dashboard/status-card.tsx")) + (await read("app/dashboard/needs-you.tsx")) + (await read("app/dashboard/business-overview.tsx")),
    );
    assert.equal((panel.match(/<h1\b/g) ?? []).length, 0);
    assert.equal((panel.match(/<h2\b/g) ?? []).length, 3);
    // Once every link is taken out, no number is left on its own.
    const withoutLinks = panel.replace(/<NumberLink\b[\s\S]*?<\/NumberLink>/g, "");
    for (const number of ["countWithNoun(", "formatOverviewCount(", "keyFactsConfirmed"]) {
      assert.ok(!withoutLinks.includes(number), `a number shown outside a link: ${number}`);
    }
    assert.equal((panel.match(/<NumberLink\b/g) ?? []).length, 15, "a number was added or taken away: list it here");
    assert.equal((panel.match(/buildListUrl\("\/inbox\/requests", \{ view: "(open|unassigned)" \}\)/g) ?? []).length, 3);
    // Without a team (a person, a business of one), the requests no
    // conversation lists wait for you; with one, those nobody has.
    assert.match(panel, /hasTeam && support\.unassignedTickets > 0/);
    assert.match(panel, /!hasTeam && support\.requestsWaitingForYou > 0 && \(\s*<WaitingRow>\s*<NumberLink href=\{buildListUrl\("\/inbox\/requests", \{ view: "open" \}\)\}/);
    // Conversations that need you open the Inbox's own "Needs you" (step 47).
    assert.match(panel, /buildListUrl\("\/inbox", \{ view: "needs-you" \}\)/);
    assert.ok(!panel.includes('"/dashboard"'), "a number still opens the old ticket list");
    // The posts scheduled for the next 7 days (due ones too) open the
    // queue's Scheduled list, which lists due posts; the calendar starts at
    // today and would hide them.
    assert.match(panel, /<NumberLink href="\/cofounder\/queue#queue-waiting"[^>]*>\s*\{`\$\{countWithNoun\(numbers\.postsScheduledNextWeek,/);
    assert.match(withoutComments(await read("app/cofounder/queue/page.tsx")), /<JobSection id="queue-waiting" title=\{`Scheduled /);
    // The ticket list is the Inbox's All requests since step 47.
    const requests = withoutComments(await read("app/inbox/requests/page.tsx"));
    assert.match(requests, /<TicketViews query=\{query\} counts=\{counts\} \/>/);
    assert.match(requests, /<PaginationLinks basePath="\/inbox\/requests"/);
    for (const file of ["app/inbox/requests/ticket-views.tsx", "app/inbox/requests/ticket-list-empty.tsx"]) {
      assert.ok(!(await read(file)).includes("/dashboard"), `${file} still links the dashboard`);
    }
  });

  await check("home: the status card's sentence says how many people and things wait for the owner in words, says 'all quiet' only when nothing is open, and names a team only when there is one", async () => {
    assert.equal(briefingSentence({ peopleWaiting: 1, otherThingsWaiting: 0, openTickets: 4, hasTeam: true }), "One person is waiting for you below.");
    assert.equal(briefingSentence({ peopleWaiting: 2, otherThingsWaiting: 0, openTickets: 2, hasTeam: true }), "Two people are waiting for you below.");
    assert.equal(briefingSentence({ peopleWaiting: 0, otherThingsWaiting: 1, openTickets: 4, hasTeam: true }), "One thing is waiting for you below.");
    assert.equal(briefingSentence({ peopleWaiting: 0, otherThingsWaiting: 3, openTickets: 0, hasTeam: true }), "Three things are waiting for you below.");
    assert.equal(briefingSentence({ peopleWaiting: 12, otherThingsWaiting: 1, openTickets: 0, hasTeam: true }), "12 people and one more thing are waiting for you below.");
    assert.equal(briefingSentence({ peopleWaiting: 0, otherThingsWaiting: 0, openTickets: 2, hasTeam: true }), "Nothing is waiting for you. Your team has the open requests in hand.");
    assert.equal(briefingSentence({ peopleWaiting: 0, otherThingsWaiting: 0, openTickets: 0, hasTeam: true }), "All quiet. Nothing is waiting for you.");
    // A person or a business of one has no team to have their requests.
    assert.equal(briefingSentence({ peopleWaiting: 0, otherThingsWaiting: 0, openTickets: 2, hasTeam: false }), "Nothing is waiting for you.");
    assert.equal(briefingSentence({ peopleWaiting: 0, otherThingsWaiting: 0, openTickets: 0, hasTeam: false }), "All quiet. Nothing is waiting for you.");
    assert.equal(briefingSentence({ peopleWaiting: 0, otherThingsWaiting: 1, openTickets: 2, hasTeam: false }), "One thing is waiting for you below.");
  });
}
