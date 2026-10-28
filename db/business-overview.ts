import "server-only";
import { and, eq, gte, inArray, lt, not, or, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { OVERVIEW_COUNT_LIMIT, OVERVIEW_WINDOW_DAYS } from "@/lib/business-overview";
import { callOutcomeCondition } from "./call-filters";
import { db } from "./client";
import { isStuckInboundEmail } from "./inbound-email-processing";
import { isCutOffWhileSending } from "./publish-runs";
import { calls, companies, contentDrafts, inboundEmails, publishJobs, tickets } from "./schema";
import { ticketViewCondition } from "./ticket-filters";

// The numbers of the dashboard's "Business overview" (step 43), for one
// company. Every count is the company's own (company_id first in each
// WHERE) and reads at most OVERVIEW_COUNT_LIMIT + 1 rows, so the page never
// reads everything a company ever had (the ticket list's own view counts
// do; CLAUDE.md, known gaps). Each count uses the same condition as the
// list it links to (the ticket views, the call filters, the stuck emails,
// the queue's "needs attention"), so a number matches what it opens.

export type SupportOverviewCounts = {
  openTickets: number;
  unassignedTickets: number;
  callsLastWeek: number;
  callsSolvedByAiLastWeek: number;
  // Received emails still being turned into tickets, and those stuck at it
  // (unfinished 15+ minutes: the Emails page offers "Process again").
  emailsWaiting: number;
  emailsStuck: number;
};

export type CofounderOverviewCounts = {
  // Written and not yet approved (status "draft").
  draftsWaitingForApproval: number;
  // Posts waiting in the queue to go out within the next 7 days (or due
  // already and waiting for the next run).
  postsScheduledNextWeek: number;
  // An owner must check the platform: "needs attention", or a run cut off
  // while sending (the queue shows it so at once).
  postsNeedingAttention: number;
  // Posts that failed in the last 7 days (the queue's Failed list).
  postsFailedLastWeek: number;
};

// Reads the support half for one company. viewerUserId: the session's
// person (the ticket views' conditions take one; "open" and "unassigned"
// don't depend on it).
export async function getSupportOverviewCounts(companyId: string, viewerUserId: string): Promise<SupportOverviewCounts> {
  const callsLastWeek = and(eq(calls.companyId, companyId), gte(calls.createdAt, daysFromNow(-OVERVIEW_WINDOW_DAYS)));
  const unfinishedEmail = and(eq(inboundEmails.companyId, companyId), inArray(inboundEmails.status, ["received", "processing"]));
  const stuckEmail = isStuckInboundEmail() ?? sql`false`;
  const [counts] = await db
    .select({
      openTickets: countUpToLimit(tickets, and(eq(tickets.companyId, companyId), ticketViewCondition("open", viewerUserId))),
      unassignedTickets: countUpToLimit(tickets, and(eq(tickets.companyId, companyId), ticketViewCondition("unassigned", viewerUserId))),
      callsLastWeek: countUpToLimit(calls, callsLastWeek),
      callsSolvedByAiLastWeek: countUpToLimit(calls, and(callsLastWeek, callOutcomeCondition("solved"))),
      emailsWaiting: countUpToLimit(inboundEmails, and(unfinishedEmail, not(stuckEmail))),
      emailsStuck: countUpToLimit(inboundEmails, and(unfinishedEmail, stuckEmail)),
    })
    .from(companies)
    .where(eq(companies.id, companyId));
  return counts ?? { openTickets: 0, unassignedTickets: 0, callsLastWeek: 0, callsSolvedByAiLastWeek: 0, emailsWaiting: 0, emailsStuck: 0 };
}

// Reads the Co-Founder half for one company (the key facts and the
// accounts come from their own pages' reads: services/business-overview.ts).
export async function getCofounderOverviewCounts(companyId: string): Promise<CofounderOverviewCounts> {
  const companyJobs = eq(publishJobs.companyId, companyId);
  const [counts] = await db
    .select({
      draftsWaitingForApproval: countUpToLimit(contentDrafts, and(eq(contentDrafts.companyId, companyId), eq(contentDrafts.status, "draft"))),
      postsScheduledNextWeek: countUpToLimit(
        publishJobs,
        and(companyJobs, eq(publishJobs.status, "queued"), lt(publishJobs.scheduledFor, daysFromNow(OVERVIEW_WINDOW_DAYS))),
      ),
      postsNeedingAttention: countUpToLimit(publishJobs, and(companyJobs, or(eq(publishJobs.status, "needs_attention"), isCutOffWhileSending()))),
      postsFailedLastWeek: countUpToLimit(
        publishJobs,
        and(companyJobs, eq(publishJobs.status, "failed"), gte(publishJobs.updatedAt, daysFromNow(-OVERVIEW_WINDOW_DAYS))),
      ),
    })
    .from(companies)
    .where(eq(companies.id, companyId));
  return counts ?? { draftsWaitingForApproval: 0, postsScheduledNextWeek: 0, postsNeedingAttention: 0, postsFailedLastWeek: 0 };
}

// One count, read as a subquery of the company's own row: how many rows of
// `table` match, reading at most one past the limit (Postgres stops there).
// WHY one past: the page can then tell "exactly 10,000" from "more".
function countUpToLimit(table: PgTable, where: SQL | undefined): SQL<number> {
  return sql<number>`(select count(*) from (select 1 from ${table} where ${where ?? sql`false`} limit ${OVERVIEW_COUNT_LIMIT + 1}) as counted)`.mapWith(Number);
}

// now() plus (or, negative, minus) this many days, by the database's clock.
function daysFromNow(days: number): SQL {
  return sql`now() + make_interval(days => ${days})`;
}
