import type { MissingPlanFact } from "@/lib/marketing-plan/plan-readiness";
import type { MarketingPlan } from "@/lib/marketing-plan/plan-schema";
import type { MarketingPlanVersionRow } from "@/lib/types/marketing-plans";

// The Co-Founder's Strategy page (step 37): the current marketing plan, its
// older versions, whether a new one can be made, and the support-trends
// setting. Members read all of it; only owners make plans and change the
// setting.

export type PlanVersionSummary = MarketingPlanVersionRow;

export type ShownPlan = {
  version: number;
  createdAt: Date;
  createdByName: string | null;
  goalNote: string | null;
  // null: saved by older code in a shape this page can't show.
  content: MarketingPlan | null;
  // The confirmed facts it was made from, as they were then.
  factsUsed: { topic: string; label: string; value: string }[];
  // Titles read within the company; null: the article was deleted since.
  knowledgeUsed: { articleId: string; title: string | null }[];
  usedSupportTrends: boolean;
  // The performance review it read as past performance (step 42); null: none.
  pastPerformance: { reviewedAt: Date; periodStart: Date; periodEnd: Date } | null;
  // The confirmed facts are no longer exactly the ones it was made from.
  profileChangedSince: boolean;
};

export type MarketingStrategy = {
  current: ShownPlan | null;
  // 0: no plan yet. Versions are 1, 2, 3, ..., so this is also how many there are.
  newestVersion: number;
  // The newest PLAN_VERSIONS_SHOWN, newest first.
  versions: PlanVersionSummary[];
  // What a new plan still needs (none: one can be made).
  missingForPlan: MissingPlanFact[];
  usesSupportTrends: boolean;
};

export type PlanVersionPage = { plan: ShownPlan; newestVersion: number };
