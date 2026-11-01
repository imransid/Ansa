import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageLoading } from "@/components/page-loading";
import { isCoreOn } from "@/lib/core-api";
import { getHomeListsFromCore, type HomeLists } from "@/lib/core-views/home";
import { getSetupStateFromCore } from "@/lib/core-views/restaurant-setup";
import { requireSessionContext, type SessionContext } from "@/lib/session";
import { getSetupStateForSession } from "@/services/assistant-settings";
import { getBusinessOverviewForSession } from "@/services/business-overview";
import { getAssistantActivityForSession } from "@/services/conversations";
import { getFirstRunHintsForSession } from "@/services/dashboard";
import { countUndeliveredCustomerEmailsForSession } from "@/services/undelivered-emails";
import { getAwaySummaryForSession, getPresenceForSession } from "@/services/away";
import { getGettingStartedForSession, getNeedsYouForSession } from "@/services/home";
import { countNewOrdersForSession } from "@/services/orders";
import { AssistantActivity } from "./assistant-activity";
import { AwaySummaryCard } from "./away-panel";
import { BusinessOverviewPanel } from "./business-overview";
import { FirstRunNotices } from "./first-run-notices";
import { GettingStarted } from "./getting-started";
import { countWaiting, NeedsYou } from "./needs-you";
import { StatusCard } from "./status-card";

// The tab says what the page and the sidebar call it.
export const metadata: Metadata = { title: "Home - ansa" };

// Home (step 44; simplified in the "easy to use" pass of 2026-11-01): what
// ansa is doing right now with the one button that changes it, what's left
// to set up, who needs you by name, what ansa did, and a business's numbers
// last. The ticket list that was here moved to the Inbox (app/inbox/page.tsx).
export default function HomePage() {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-8 p-6">
      {/* Cache Components rule: the session is only known at request time. */}
      <Suspense fallback={<PageLoading />}>
        <HomeContent />
      </Suspense>
    </main>
  );
}

// Reads the session once and hands it to everything on the page.
async function HomeContent() {
  const session = await requireSessionContext("/dashboard");
  // The new backend when it is switched on (lib/core-api.ts), else services/.
  // Core doesn't give Home's status (Presence), the business's numbers, the
  // undelivered emails or the first-run hints yet: those stay on services/.
  const coreOn = isCoreOn();
  // An owner whose restaurant isn't set up yet goes through the setup first
  // (step 45): a new owner lands here after confirming their email.
  const setup = coreOn ? await getSetupStateFromCore() : await getSetupStateForSession(session);
  if (!setup.finished && setup.canSetUp) {
    redirect("/welcome");
  }
  const [undeliveredEmails, hints, overview, presence, lists] = await Promise.all([
    countUndeliveredCustomerEmailsForSession(session),
    getFirstRunHintsForSession(session),
    getBusinessOverviewForSession(session),
    getPresenceForSession(session),
    coreOn ? getHomeListsFromCore() : getHomeListsForSession(session),
  ]);
  const { activity, awaySummary, gettingStarted, needsYou, newOrders } = lists;
  const personal = presence.kind === "personal";

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
      <StatusCard presence={presence} waiting={countWaiting(overview, !personal && needsYou.hasTeam, newOrders)} openTickets={overview.support.openTickets} />
      {!setup.finished && (
        <p role="status" className="rounded-xl bg-attention-surface px-4 py-3 text-sm">
          An owner is still setting ansa up. Everything else works meanwhile.
        </p>
      )}
      <GettingStarted steps={gettingStarted} />
      {/* Only while ansa answers when you're away: answering always, "What ansa did" says it. */}
      {presence.availability.answerWhen === "when_away" && <AwaySummaryCard summary={awaySummary} />}
      <UndeliveredEmailsNotice count={undeliveredEmails} />
      <NeedsYou conversations={needsYou} overview={overview} personal={personal} newOrders={newOrders} />
      {!personal && <FirstRunNotices hints={hints} />}
      <AssistantActivity rows={activity} />
      {!personal && <BusinessOverviewPanel overview={overview} />}
    </>
  );
}

// Home's lists from services/: what's left to set up, what ansa did while
// you were away, who needs you, new orders and ansa's newest work.
async function getHomeListsForSession(session: SessionContext): Promise<HomeLists> {
  const [activity, awaySummary, gettingStarted, needsYou, newOrders] = await Promise.all([
    getAssistantActivityForSession(session),
    getAwaySummaryForSession(session),
    getGettingStartedForSession(session),
    getNeedsYouForSession(session),
    countNewOrdersForSession(session),
  ]);
  return { activity, awaySummary, gettingStarted, needsYou, newOrders };
}

// Customers who were never told their request is solved (step 27): otherwise
// that only shows on each ticket's own page, which nobody opens again.
function UndeliveredEmailsNotice({ count }: { count: number }) {
  if (count === 0) {
    return null;
  }
  return (
    <p role="status" className="rounded-xl bg-destructive/8 px-4 py-3 text-sm">
      {count === 1 ? "1 customer email was" : `${count} customer emails were`} not delivered.{" "}
      <Link href="/emails" className="font-medium underline">
        See which on the Emails page
      </Link>
    </p>
  );
}
