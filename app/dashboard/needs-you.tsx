import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { LocalDateTime } from "@/components/local-date-time";
import { StatusDot } from "@/components/status-dot";
import { countWithNoun, OVERVIEW_WINDOW_DAYS } from "@/lib/business-overview";
import { CHANNEL_LABELS } from "@/lib/conversations";
import { contactLabel } from "@/lib/inbox";
import { buildListUrl } from "@/lib/pagination";
import type { BusinessOverview } from "@/services/business-overview";
import type { InboxRow } from "@/services/conversations";
import { NumberLink } from "./number-link";

type NeedsYouProps = {
  // The newest conversations that need a person, how many there are, and
  // whether more than one person takes requests (services/home.ts).
  conversations: { rows: InboxRow[]; total: number; hasTeam: boolean };
  overview: BusinessOverview;
  personal: boolean;
  // Orders nobody accepted yet (step 52).
  newOrders: number;
};

// Home's "Needs you" (the "easy to use" pass of 2026-11-01): the people
// waiting for an answer, each by name with why, then anything else that
// waits for someone (a request nobody has, a stuck email, a post to check,
// an account to reconnect), each a link to where it is handled. Only what
// waits; with nothing, one calm line.
export function NeedsYou({ conversations, overview, personal, newOrders }: NeedsYouProps) {
  const showUnassigned = !personal && conversations.hasTeam;
  const { peopleWaiting, otherThingsWaiting } = countWaiting(overview, showUnassigned, newOrders);
  const nothingWaiting = peopleWaiting === 0 && otherThingsWaiting === 0;
  return (
    <section aria-labelledby="needs-you-heading" className="grid content-start gap-2">
      <h2 id="needs-you-heading" className="text-lg font-semibold">
        Needs you
      </h2>
      {nothingWaiting ? (
        <p className="border-y py-3">
          <StatusDot tone="success">Nothing needs you right now.</StatusDot>
        </p>
      ) : (
        <ul className="divide-y border-y">
          {newOrders > 0 && (
            <WaitingRow>
              <NumberLink href="/orders" className={ROW_LINK}>
                {`${countWithNoun(newOrders, "new order", "new orders")} to accept`}
                <RowArrow />
              </NumberLink>
            </WaitingRow>
          )}
          {conversations.rows.map((row) => (
            <li key={row.id}>
              <Link href={`/inbox/${row.id}`} className="grid gap-0.5 py-3 hover:text-link sm:grid-cols-[1fr_auto] sm:gap-4">
                <span className="grid min-w-0 gap-0.5">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">{contactLabel(row) || "Someone"}</span>
                    <span className="text-xs text-muted-foreground">{CHANNEL_LABELS[row.channel]}</span>
                  </span>
                  <span className="truncate text-sm text-muted-foreground">
                    {row.openTicket ? row.openTicket.subject : "ansa wrote a reply: it waits for you to send it."}
                  </span>
                </span>
                <span className="text-xs text-subtle-foreground sm:text-right">
                  <LocalDateTime iso={row.lastActivityAt.toISOString()} />
                </span>
              </Link>
            </li>
          ))}
          {conversations.total > conversations.rows.length && (
            <WaitingRow>
              <NumberLink href={buildListUrl("/inbox", { view: "needs-you" })} className={ROW_LINK}>
                {`See all ${countWithNoun(conversations.total, "conversation", "conversations")} that need you`}
                <RowArrow />
              </NumberLink>
            </WaitingRow>
          )}
          <OtherThingsWaiting overview={overview} showUnassigned={showUnassigned} />
        </ul>
      )}
    </section>
  );
}

function OtherThingsWaiting({ overview, showUnassigned }: { overview: BusinessOverview; showUnassigned: boolean }) {
  const { support, cofounder } = overview;
  return (
    <>
      {/* Without a team to share them with, requests are the conversations listed above. */}
      {showUnassigned && support.unassignedTickets > 0 && (
        <WaitingRow>
          <NumberLink href={buildListUrl("/inbox/requests", { view: "unassigned" })} className={ROW_LINK}>
            {countWithNoun(support.unassignedTickets, "request has nobody on it", "requests have nobody on them")}
            <RowArrow />
          </NumberLink>
        </WaitingRow>
      )}
      {support.emailsStuck > 0 && (
        <WaitingRow>
          <NumberLink href="/emails" className={ROW_LINK}>
            {`${countWithNoun(support.emailsStuck, "email is", "emails are")} stuck`}
            <RowArrow />
          </NumberLink>
        </WaitingRow>
      )}
      {cofounder && cofounder.postsNeedingAttention > 0 && (
        <WaitingRow>
          <NumberLink href="/cofounder/queue" className={ROW_LINK}>
            {`${countWithNoun(cofounder.postsNeedingAttention, "post needs", "posts need")} checking`}
            <RowArrow />
          </NumberLink>
        </WaitingRow>
      )}
      {cofounder && cofounder.postsFailedLastWeek > 0 && (
        <WaitingRow>
          <NumberLink href="/cofounder/queue" className={ROW_LINK}>
            {`${countWithNoun(cofounder.postsFailedLastWeek, "post", "posts")} failed in the last ${OVERVIEW_WINDOW_DAYS} days`}
            <RowArrow />
          </NumberLink>
        </WaitingRow>
      )}
      {cofounder && cofounder.accountsNeedingReconnect > 0 && (
        <WaitingRow>
          <NumberLink href="/cofounder/accounts" className={ROW_LINK}>
            {`${countWithNoun(cofounder.accountsNeedingReconnect, "social media account needs", "social media accounts need")} connecting again`}
            <RowArrow />
          </NumberLink>
        </WaitingRow>
      )}
    </>
  );
}

// How many people and kinds of things wait for someone: the status card's
// sentence (lib/home-briefing.ts) and whether "Needs you" lists anything.
export function countWaiting({ support, cofounder }: BusinessOverview, showUnassigned: boolean, newOrders: number) {
  const others = [newOrders, showUnassigned ? support.unassignedTickets : 0, support.emailsStuck];
  if (cofounder) {
    others.push(cofounder.postsNeedingAttention, cofounder.postsFailedLastWeek, cofounder.accountsNeedingReconnect);
  }
  return { peopleWaiting: support.conversationsNeedingYou, otherThingsWaiting: others.filter((count) => count > 0).length };
}

// The amber dot says "needs you" to the eye; the heading says it in words.
function WaitingRow({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span aria-hidden className="size-1.75 shrink-0 rounded-full bg-attention" />
      {children}
    </li>
  );
}

const ROW_LINK = "flex min-h-12 flex-1 items-center justify-between gap-3 rounded-sm py-2 text-sm hover:text-link";

function RowArrow() {
  return <ChevronRight aria-hidden className="size-4 shrink-0 text-subtle-foreground" />;
}
