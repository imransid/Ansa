import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageLoading } from "@/components/page-loading";
import { RefreshEvery } from "@/components/refresh-every";
import { getPhoneAwayFromCore } from "@/lib/core-views/devices";
import { getHomeFromCore } from "@/lib/core-views/home";
import { getSetupStateFromCore } from "@/lib/core-views/restaurant-setup";
import { requireSessionContext } from "@/lib/session";
import { AssistantActivity } from "./assistant-activity";
import { AwaySummaryCard } from "./away-panel";
import { BusinessOverviewPanel } from "./business-overview";
import { FirstRunNotices } from "./first-run-notices";
import { GettingStarted } from "./getting-started";
import { PackageNotice } from "./package-notice";
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

// Everything Home shows comes from core in one read.
async function HomeContent() {
  await requireSessionContext("/dashboard");
  // An owner whose restaurant isn't set up yet goes through the setup first
  // (step 45): a new owner lands here after confirming their email.
  const setup = await getSetupStateFromCore();
  if (!setup.finished && setup.canSetUp) {
    redirect("/welcome");
  }
  // phoneAway: ansa is away because no connected phone checked in (Settings → Your phone).
  const [home, phoneAway] = await Promise.all([getHomeFromCore(), getPhoneAwayFromCore()]);
  const { undeliveredEmails, hints, overview, activity, presence, awaySummary, gettingStarted, needsYou, newOrders, packageStatus } = home;
  const personal = presence.kind === "personal";
  const hasTeam = !personal && needsYou.hasTeam;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
      {/* Who needs you and what ansa did show up by themselves. */}
      <RefreshEvery seconds={5} />
      <StatusCard
        presence={presence}
        phoneAwaySince={phoneAway?.since ?? null}
        waiting={countWaiting(overview, hasTeam, newOrders)}
        openTickets={overview.support.openTickets}
        hasTeam={hasTeam}
      />
      {!setup.finished && (
        <p role="status" className="rounded-xl bg-attention-surface px-4 py-3 text-sm">
          An owner is still setting ansa up. Everything else works meanwhile.
        </p>
      )}
      <PackageNotice status={packageStatus} />
      <GettingStarted steps={gettingStarted} />
      {/* Only while ansa answers when you're away: answering always, "What ansa did" says it. */}
      {presence.availability.answerWhen === "when_away" && <AwaySummaryCard summary={awaySummary} personal={personal} />}
      <UndeliveredEmailsNotice count={undeliveredEmails} />
      <NeedsYou conversations={needsYou} overview={overview} personal={personal} newOrders={newOrders} />
      {!personal && <FirstRunNotices hints={hints} />}
      <AssistantActivity rows={activity} />
      {!personal && <BusinessOverviewPanel overview={overview} />}
    </>
  );
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
