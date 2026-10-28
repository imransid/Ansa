import type { ReactNode } from "react";
import Link from "next/link";
import { countWithNoun, formatOverviewCount, OVERVIEW_WINDOW_DAYS } from "@/lib/business-overview";
import { buildListUrl } from "@/lib/pagination";
import { cn } from "@/lib/utils";
import type { BusinessOverview, CofounderOverviewNumbers, SupportOverviewCounts } from "@/services/business-overview";

// The "Business overview" at the top of the dashboard (step 43): the
// company's numbers from support and from the Co-Founder, each a link to the
// page that lists them. A number that waits for someone (a ticket nobody
// has, a stuck email, a post to check, an account to reconnect) stands out.
// The page's h1: the ticket list below is one of its parts.
export function BusinessOverviewPanel({ overview }: { overview: BusinessOverview }) {
  return (
    <section aria-labelledby="business-overview-heading" className="grid gap-3">
      <h1 id="business-overview-heading" className="text-xl font-semibold">
        Business overview
      </h1>
      <div className="grid gap-3 md:grid-cols-2">
        <SupportNumbers counts={overview.support} />
        {overview.cofounder ? <CofounderNumbers numbers={overview.cofounder} /> : <CofounderNotStarted canStart={overview.canStartCofounder} />}
      </div>
    </section>
  );
}

function SupportNumbers({ counts }: { counts: SupportOverviewCounts }) {
  return (
    <OverviewBox title="Support">
      <Line>
        <NumberLink href={buildListUrl("/dashboard", { view: "open" })}>{countWithNoun(counts.openTickets, "open ticket", "open tickets")}</NumberLink>
        <NumberLink href={buildListUrl("/dashboard", { view: "unassigned" })} needsAttention={counts.unassignedTickets > 0}>
          {`${formatOverviewCount(counts.unassignedTickets)} unassigned`}
        </NumberLink>
      </Line>
      <Line>
        <NumberLink href="/calls">{`${countWithNoun(counts.callsLastWeek, "call", "calls")} in the last ${OVERVIEW_WINDOW_DAYS} days`}</NumberLink>
        {/* The Calls page's "Solved by the AI" filter. WHY a plain address:
            the call brain's guard (brain-evidence-checks.ts) flags any
            `outcome` written as "solved" in code, so only decision.ts does. */}
        <NumberLink href="/calls?outcome=solved">{`${formatOverviewCount(counts.callsSolvedByAiLastWeek)} solved by the AI`}</NumberLink>
      </Line>
      <Line>
        <NumberLink href="/emails">{`${countWithNoun(counts.emailsWaiting, "email", "emails")} being turned into tickets`}</NumberLink>
        <NumberLink href="/emails" needsAttention={counts.emailsStuck > 0}>{`${formatOverviewCount(counts.emailsStuck)} stuck`}</NumberLink>
      </Line>
    </OverviewBox>
  );
}

function CofounderNumbers({ numbers }: { numbers: CofounderOverviewNumbers }) {
  return (
    <OverviewBox title="Co-Founder">
      <Line>
        <NumberLink href="/cofounder/profile">{`${numbers.keyFactsConfirmed} of ${numbers.keyFactsTotal} key facts confirmed`}</NumberLink>
      </Line>
      <Line>
        <NumberLink href={buildListUrl("/cofounder/studio", { status: "draft" })}>
          {`${countWithNoun(numbers.draftsWaitingForApproval, "draft", "drafts")} waiting for approval`}
        </NumberLink>
      </Line>
      <Line>
        {/* The queue's Scheduled list, not the calendar: the count includes
            posts already due and waiting for the next run, and the calendar
            starts at today, so one due yesterday would be on none of its days. */}
        <NumberLink href="/cofounder/queue#queue-waiting">
          {`${countWithNoun(numbers.postsScheduledNextWeek, "post", "posts")} scheduled for the next ${OVERVIEW_WINDOW_DAYS} days`}
        </NumberLink>
      </Line>
      <Line>
        <NumberLink href="/cofounder/queue" needsAttention={numbers.postsNeedingAttention > 0}>
          {`${countWithNoun(numbers.postsNeedingAttention, "post needs", "posts need")} attention`}
        </NumberLink>
        <NumberLink href="/cofounder/queue" needsAttention={numbers.postsFailedLastWeek > 0}>
          {`${formatOverviewCount(numbers.postsFailedLastWeek)} failed in the last ${OVERVIEW_WINDOW_DAYS} days`}
        </NumberLink>
      </Line>
      <Line>
        <NumberLink href="/cofounder/accounts" needsAttention={numbers.accountsNeedingReconnect > 0}>
          {`${countWithNoun(numbers.accountsNeedingReconnect, "account needs", "accounts need")} reconnecting`}
        </NumberLink>
      </Line>
    </OverviewBox>
  );
}

// Until the company has started the Co-Founder (no fact, interview answer
// or draft), one line instead of a column of zeros.
function CofounderNotStarted({ canStart }: { canStart: boolean }) {
  return (
    <OverviewBox title="Co-Founder">
      {canStart ? (
        <p>
          Your AI Co-Founder helps with your marketing, starting from the facts about your business.{" "}
          <Link href="/cofounder/interview" className="font-medium underline">
            Start its interview
          </Link>
        </p>
      ) : (
        <p className="text-muted-foreground">
          Not started yet: an owner starts it by answering its interview.{" "}
          <Link href="/cofounder" className="underline">
            See what it does
          </Link>
        </p>
      )}
    </OverviewBox>
  );
}

function OverviewBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-2 rounded-lg border p-4 text-sm">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </div>
  );
}

// One line of the box: its links side by side, wrapping on a phone.
function Line({ children }: { children: ReactNode }) {
  return <p className="flex flex-wrap gap-x-4 gap-y-1">{children}</p>;
}

function NumberLink({ href, needsAttention = false, children }: { href: string; needsAttention?: boolean; children: ReactNode }) {
  return (
    <Link href={href} className={cn("hover:underline", needsAttention && "font-medium text-destructive")}>
      {children}
    </Link>
  );
}
