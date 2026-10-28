import "server-only";
import { and, desc, eq, max, sql } from "drizzle-orm";
import { canManageMarketingStrategy } from "@/lib/cofounder/permissions";
import type { ConfirmedFact } from "@/lib/marketing-plan/plan-prompt";
import type { MarketingPlan } from "@/lib/marketing-plan/plan-schema";
import { db } from "./client";
import { recordActivity } from "./cofounder-activity";
import { lockCompanyRow } from "./company-lock";
import { lockActiveAuthorRole } from "./knowledge-author";
import { marketingPlans, performanceReviews, users } from "./schema";

// One company's marketing plans (step 37): saving a new version (recorded
// in the activity log, step 41), and reading them back. Only an active
// owner saves one: the role is read again, locked, in the transaction that
// writes (db/knowledge-author.ts).

export type MarketingPlanRow = {
  version: number;
  goalNote: string | null;
  // As stored: the services read them with the plan's own schema.
  plan: unknown;
  factsUsed: unknown;
  knowledgeUsed: string[];
  usedSupportTrends: boolean;
  // The performance review it read as past performance (step 42), read
  // within the company; null: none.
  pastPerformance: { reviewedAt: Date; periodStart: Date; periodEnd: Date } | null;
  createdAt: Date;
  // Who made it, read within the company.
  createdByName: string | null;
};

export type MarketingPlanVersionRow = {
  version: number;
  createdAt: Date;
  createdByName: string | null;
  factCount: number;
};

export type NewMarketingPlan = {
  goalNote: string | null;
  plan: MarketingPlan;
  factsUsed: ConfirmedFact[];
  knowledgeUsed: string[];
  usedSupportTrends: boolean;
  performanceReviewId: string | null;
};

export type SavePlanOutcome = { outcome: "saved"; version: number } | { outcome: "not-allowed" };

const planColumns = {
  version: marketingPlans.version,
  goalNote: marketingPlans.goalNote,
  plan: marketingPlans.plan,
  factsUsed: marketingPlans.factsUsed,
  knowledgeUsed: marketingPlans.knowledgeUsed,
  usedSupportTrends: marketingPlans.usedSupportTrends,
  reviewedAt: performanceReviews.createdAt,
  reviewPeriodStart: performanceReviews.periodStart,
  reviewPeriodEnd: performanceReviews.periodEnd,
  createdAt: marketingPlans.createdAt,
  createdByName: users.name,
};

// company_id matched too, so a name from another company can never show up.
const creatorInCompany = and(eq(users.id, marketingPlans.createdByUserId), eq(users.companyId, marketingPlans.companyId));
// The same for the review a plan read.
const reviewInCompany = and(eq(performanceReviews.id, marketingPlans.performanceReviewId), eq(performanceReviews.companyId, marketingPlans.companyId));

// Saves a new version of one company's plan, made by actorUserId, while
// they are still an active owner. Returns its version number. WHY the
// company row lock first: two plans saved at the same moment would both
// read the same newest version and take the same next one (the unique
// constraint would then refuse one, and that plan would be lost). Under the
// lock they count one after the other, as ticket numbers do
// (db/company-lock.ts: first, before the person's row).
export async function saveMarketingPlan(companyId: string, actorUserId: string, newPlan: NewMarketingPlan): Promise<SavePlanOutcome> {
  return db.transaction(async (tx) => {
    await lockCompanyRow(tx, companyId);
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    if (!role || !canManageMarketingStrategy(role)) {
      return { outcome: "not-allowed" };
    }
    const [newest] = await tx.select({ version: max(marketingPlans.version) }).from(marketingPlans).where(eq(marketingPlans.companyId, companyId));
    const version = (newest?.version ?? 0) + 1;
    await tx.insert(marketingPlans).values({
      companyId,
      version,
      goalNote: newPlan.goalNote,
      plan: newPlan.plan,
      factsUsed: newPlan.factsUsed,
      knowledgeUsed: newPlan.knowledgeUsed,
      usedSupportTrends: newPlan.usedSupportTrends,
      performanceReviewId: newPlan.performanceReviewId,
      createdByUserId: actorUserId,
    });
    await recordActivity(tx, companyId, [{ action: "plan_created", actorUserId, planVersion: version }]);
    return { outcome: "saved", version };
  });
}

// One version of one company's plan (undefined: the company has no such version).
export async function getMarketingPlanVersion(companyId: string, version: number): Promise<MarketingPlanRow | undefined> {
  const [row] = await db
    .select(planColumns)
    .from(marketingPlans)
    .leftJoin(users, creatorInCompany)
    .leftJoin(performanceReviews, reviewInCompany)
    .where(and(eq(marketingPlans.companyId, companyId), eq(marketingPlans.version, version)));
  return row ? toPlanRow(row) : undefined;
}

// One company's newest plan: its current one (undefined: none yet).
export async function getNewestMarketingPlan(companyId: string): Promise<MarketingPlanRow | undefined> {
  const [row] = await db
    .select(planColumns)
    .from(marketingPlans)
    .leftJoin(users, creatorInCompany)
    .leftJoin(performanceReviews, reviewInCompany)
    .where(eq(marketingPlans.companyId, companyId))
    .orderBy(desc(marketingPlans.version))
    .limit(1);
  return row ? toPlanRow(row) : undefined;
}

// The number of one company's newest version (0: no plan yet).
export async function getNewestMarketingPlanVersion(companyId: string): Promise<number> {
  const [newest] = await db.select({ version: max(marketingPlans.version) }).from(marketingPlans).where(eq(marketingPlans.companyId, companyId));
  return newest?.version ?? 0;
}

// The newest `limit` versions of one company's plan, newest first. Versions
// are numbered 1, 2, 3, ... and never deleted, so the first one's number is
// how many there are.
export async function listMarketingPlanVersions(companyId: string, limit: number): Promise<MarketingPlanVersionRow[]> {
  return db
    .select({
      version: marketingPlans.version,
      createdAt: marketingPlans.createdAt,
      createdByName: users.name,
      factCount: sql<number>`jsonb_array_length(${marketingPlans.factsUsed})`.mapWith(Number),
    })
    .from(marketingPlans)
    .leftJoin(users, creatorInCompany)
    .where(eq(marketingPlans.companyId, companyId))
    .orderBy(desc(marketingPlans.version))
    .limit(limit);
}

type PlanColumns = {
  version: number;
  goalNote: string | null;
  plan: unknown;
  factsUsed: unknown;
  knowledgeUsed: string[];
  usedSupportTrends: boolean;
  reviewedAt: Date | null;
  reviewPeriodStart: Date | null;
  reviewPeriodEnd: Date | null;
  createdAt: Date;
  createdByName: string | null;
};

// A plan row with its review's dates as one value (null: it read none).
function toPlanRow(row: PlanColumns): MarketingPlanRow {
  const { reviewedAt, reviewPeriodStart, reviewPeriodEnd, ...plan } = row;
  const pastPerformance = reviewedAt && reviewPeriodStart && reviewPeriodEnd ? { reviewedAt, periodStart: reviewPeriodStart, periodEnd: reviewPeriodEnd } : null;
  return { ...plan, pastPerformance };
}
