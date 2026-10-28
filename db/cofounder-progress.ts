import "server-only";
import { and, eq, exists, ne, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { db } from "./client";
import { businessFacts, companies, contentDrafts, marketingPlans, onboardingMessages, postMetrics, publishJobs } from "./schema";

// Where one company stands with the Co-Founder (step 43): whether each step
// the Overview's checklist names has happened, and whether the company has
// started at all (the dashboard shows the Co-Founder's numbers only then).
// Each is a yes/no that Postgres answers from the first row it finds
// (EXISTS), with the company first in every WHERE, so it costs the same for
// a company with years of posts as for a new one.

export type CofounderProgress = {
  // A business fact, confirmed or only proposed.
  hasFacts: boolean;
  hasInterviewMessages: boolean;
  // Any draft, an idea the calendar planned too.
  hasDrafts: boolean;
  // A draft with something written or attached (an idea holds nothing).
  hasWrittenDraft: boolean;
  hasPlan: boolean;
  // A post ever put in the queue and not canceled before it ran: waiting,
  // out, failed or needing attention.
  hasScheduledPost: boolean;
  // Numbers read (or simulated, in development) for one of its posts.
  hasPostNumbers: boolean;
};

// Reads one company's progress in one query.
export async function getCofounderProgress(companyId: string): Promise<CofounderProgress> {
  const one = { one: sql`1` };
  const [progress] = await db
    .select({
      hasFacts: hasAny(db.select(one).from(businessFacts).where(eq(businessFacts.companyId, companyId))),
      hasInterviewMessages: hasAny(db.select(one).from(onboardingMessages).where(eq(onboardingMessages.companyId, companyId))),
      hasDrafts: hasAny(db.select(one).from(contentDrafts).where(eq(contentDrafts.companyId, companyId))),
      hasWrittenDraft: hasAny(db.select(one).from(contentDrafts).where(and(eq(contentDrafts.companyId, companyId), holdsContent()))),
      hasPlan: hasAny(db.select(one).from(marketingPlans).where(eq(marketingPlans.companyId, companyId))),
      hasScheduledPost: hasAny(db.select(one).from(publishJobs).where(and(eq(publishJobs.companyId, companyId), ne(publishJobs.status, "canceled")))),
      hasPostNumbers: hasAny(db.select(one).from(postMetrics).where(eq(postMetrics.companyId, companyId))),
    })
    .from(companies)
    .where(eq(companies.id, companyId));
  return (
    progress ?? {
      hasFacts: false,
      hasInterviewMessages: false,
      hasDrafts: false,
      hasWrittenDraft: false,
      hasPlan: false,
      hasScheduledPost: false,
      hasPostNumbers: false,
    }
  );
}

// True when the query finds a row (Postgres stops at the first).
function hasAny(rows: SQLWrapper): SQL<boolean> {
  return sql<boolean>`${exists(rows)}`;
}

// The opposite of what the content_drafts_idea_has_no_content CHECK asks of
// an idea (db/schema/content-drafts.ts): any text, a hashtag or a file.
function holdsContent(): SQL {
  return sql`not (${contentDrafts.title} = '' and ${contentDrafts.body} = '' and ${contentDrafts.callToAction} = '' and ${contentDrafts.imagePrompt} = '' and ${contentDrafts.videoScript} = '' and cardinality(${contentDrafts.hashtags}) = 0 and ${contentDrafts.mediaAssetId} is null)`;
}
