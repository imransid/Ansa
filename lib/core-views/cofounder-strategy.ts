import "server-only";
import { callCore } from "@/lib/core-api";
import { toFormErrors } from "@/lib/core-views/auth";
import { asFormResult } from "@/lib/core-views/ticket-actions";
import type { FormResult } from "@/lib/form-result";
import { planVersionSchema, supportTrendsSettingSchema } from "@/lib/validation/marketing-plan";
import type { MarketingPlanResult } from "@/services/marketing-plan";
import type { MarketingStrategy, PlanVersionPage, PlanVersionSummary, ShownPlan } from "@/services/marketing-strategy";

// The Co-Founder's marketing strategy through the new backend (core's
// /api/v1/cofounder/strategy), in the shapes the Strategy pages and their
// actions already read. Core checks the person (owners make plans and
// change the setting, members read), the input and the limits.

// A form value as the forms send it: text, or nothing.
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// Dates come as ISO text.
type CoreReviewDates = { reviewedAt: string; periodStart: string; periodEnd: string };
type CoreShownPlan = Omit<ShownPlan, "createdAt" | "pastPerformance"> & { createdAt: string; pastPerformance: CoreReviewDates | null };
type CoreVersion = Omit<PlanVersionSummary, "createdAt"> & { createdAt: string };
type CoreStrategy = Omit<MarketingStrategy, "current" | "versions"> & { current: CoreShownPlan | null; versions: CoreVersion[] };

// One stored version as the pages show it. Core has already read the plan
// (null: a shape it can't show) and applied the fact rule to it.
function toShownPlan(plan: CoreShownPlan): ShownPlan {
  const review = plan.pastPerformance;
  return {
    version: plan.version,
    createdAt: new Date(plan.createdAt),
    createdByName: plan.createdByName,
    goalNote: plan.goalNote,
    content: plan.content,
    factsUsed: plan.factsUsed ?? [],
    knowledgeUsed: plan.knowledgeUsed ?? [],
    usedSupportTrends: plan.usedSupportTrends,
    pastPerformance: review
      ? { reviewedAt: new Date(review.reviewedAt), periodStart: new Date(review.periodStart), periodEnd: new Date(review.periodEnd) }
      : null,
    profileChangedSince: plan.profileChangedSince,
  };
}

function toVersionSummary(version: CoreVersion): PlanVersionSummary {
  return { version: version.version, createdAt: new Date(version.createdAt), createdByName: version.createdByName, factCount: version.factCount };
}

// The Strategy page: the current plan, the newest versions, what a new plan
// still needs, the support-trends setting, and whether this person makes
// plans (owners).
export async function getStrategyPageFromCore(): Promise<{ page: MarketingStrategy; isOwner: boolean }> {
  const answer = await callCore<{ strategy: CoreStrategy; canManage: boolean }>("GET", "/api/v1/cofounder/strategy");
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  const { strategy, canManage } = answer.data;
  return {
    page: {
      current: strategy.current ? toShownPlan(strategy.current) : null,
      newestVersion: strategy.newestVersion,
      versions: (strategy.versions ?? []).map(toVersionSummary),
      missingForPlan: strategy.missingForPlan ?? [],
      usesSupportTrends: strategy.usesSupportTrends,
    },
    isOwner: canManage,
  };
}

// One version by the number in the address (only a claim): null for a bad
// number, or one the company has no version of (both look the same).
export async function getPlanVersionFromCore(versionParam: unknown): Promise<PlanVersionPage | null> {
  const version = planVersionSchema.safeParse(versionParam);
  if (!version.success) {
    return null;
  }
  const answer = await callCore<{ plan: CoreShownPlan; newestVersion: number }>("GET", `/api/v1/cofounder/strategy/versions/${version.data}`);
  if (!answer.ok && answer.status === 404) {
    return null;
  }
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  return { plan: toShownPlan(answer.data.plan), newestVersion: answer.data.newestVersion };
}

// "Make a new plan": core asks the AI and saves the new version, waiting
// for it (up to about 5 minutes). Refused until the facts a plan needs are
// confirmed, past the hourly limit, or when no usable plan came back.
export async function makePlanThroughCore(goalNote: unknown): Promise<MarketingPlanResult> {
  const answer = await callCore<{ version: number }>("POST", "/api/v1/cofounder/strategy/plan", { goalNote: text(goalNote) });
  return answer.ok ? { ok: true, version: answer.data.version } : { ok: false, errors: toFormErrors(answer) };
}

// Whether new plans may read the ticket counts per category. The box sends
// "on" when ticked and nothing when not; anything else is no setting.
export async function setSupportTrendsThroughCore(checkbox: unknown): Promise<FormResult> {
  const setting = supportTrendsSettingSchema.safeParse({ useSupportTrends: checkbox });
  if (!setting.success) {
    return { ok: false, errors: { message: "The setting could not be read. Reload the page and try again." } };
  }
  const answer = await callCore("POST", "/api/v1/cofounder/strategy/support-trends", { useSupportTrends: setting.data.useSupportTrends });
  return asFormResult(answer);
}
