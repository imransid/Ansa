import Link from "next/link";
import { countWithNoun, formatOverviewCount, OVERVIEW_WINDOW_DAYS } from "@/lib/business-overview";
import { buildListUrl } from "@/lib/pagination";
import type { BusinessOverview, CofounderOverviewNumbers } from "@/lib/types/business-overview";
import { NumberLink } from "./number-link";

// A business's numbers on Home (step 43; since the "easy to use" pass of
// 2026-11-01 a short list at the end of the page, as what waits for someone
// moved up to "Needs you"): requests, calls and emails, and the social media
// posts once the company started them. Every number is a NumberLink to the
// page that lists it. A person's account (step 50) doesn't show it.
export function BusinessOverviewPanel({ overview }: { overview: BusinessOverview }) {
  const { support, cofounder } = overview;
  return (
    <section aria-labelledby="business-overview-heading" className="grid content-start gap-2">
      <h2 id="business-overview-heading" className="text-lg font-semibold">
        Your business in numbers
      </h2>
      <ul className="divide-y border-y text-sm">
        <li>
          <NumberLink href={buildListUrl("/inbox/requests", { view: "open" })} className={LINE}>
            Open requests
            <Figure>{formatOverviewCount(support.openTickets)}</Figure>
          </NumberLink>
        </li>
        <li>
          <NumberLink href="/calls" className={LINE}>
            {`Calls in the last ${OVERVIEW_WINDOW_DAYS} days`}
            <Figure>{formatOverviewCount(support.callsLastWeek)}</Figure>
          </NumberLink>
        </li>
        <li>
          {/* The Calls page's "Solved by the AI" filter. WHY a plain address:
              the call brain's guard (brain-evidence-checks.ts) flags any
              `outcome` written as "solved" in code, so only decision.ts does. */}
          <NumberLink href="/calls?outcome=solved" className={LINE}>
            Calls solved by ansa
            <Figure>{formatOverviewCount(support.callsSolvedByAiLastWeek)}</Figure>
          </NumberLink>
        </li>
        <li>
          <NumberLink href="/emails" className={LINE}>
            Emails being read
            <Figure>{formatOverviewCount(support.emailsWaiting)}</Figure>
          </NumberLink>
        </li>
        {cofounder && <PostNumbers numbers={cofounder} />}
      </ul>
      {/* The call numbers count the Calls page's list, which live calls
          (step 55) aren't on: without this, calls just made looked lost. */}
      <p className="text-xs text-muted-foreground">
        Calls ansa answered live aren&apos;t counted here: each is a conversation in your{" "}
        <Link href="/inbox" className="text-link hover:underline">
          Inbox
        </Link>
        .
      </p>
    </section>
  );
}

// The social media posts' numbers, only once the company started them (a
// fact setup doesn't write, an interview answer or a draft: core decides,
// core/internal/home): never a column of zeros.
function PostNumbers({ numbers }: { numbers: CofounderOverviewNumbers }) {
  return (
    <>
      <li>
        <NumberLink href="/cofounder/profile" className={LINE}>
          Key facts about your business
          <Figure>{`${numbers.keyFactsConfirmed} of ${numbers.keyFactsTotal}`}</Figure>
        </NumberLink>
      </li>
      <li>
        <NumberLink href={buildListUrl("/cofounder/studio", { status: "draft" })} className={LINE}>
          {`${countWithNoun(numbers.draftsWaitingForApproval, "post", "posts")} waiting for your approval`}
        </NumberLink>
      </li>
      <li>
        {/* The queue's Scheduled list, not the calendar: the count includes
            posts already due and waiting for the next run, and the calendar
            starts at today, so one due yesterday would be on none of its days. */}
        <NumberLink href="/cofounder/queue#queue-waiting" className={LINE}>
          {`${countWithNoun(numbers.postsScheduledNextWeek, "post", "posts")} scheduled for the next ${OVERVIEW_WINDOW_DAYS} days`}
        </NumberLink>
      </li>
    </>
  );
}

const LINE = "flex min-h-11 items-center justify-between gap-3 py-2 hover:text-link";

function Figure({ children }: { children: string }) {
  return <span className="font-semibold numbers">{children}</span>;
}
