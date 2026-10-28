import "server-only";
import { z } from "zod";
import { getSupportTrendsSetting, setSupportTrendsSetting } from "@/db/cofounder-settings";
import { getKnowledgeArticleTitles } from "@/db/knowledge-lookups";
import {
  getMarketingPlanVersion,
  getNewestMarketingPlan,
  getNewestMarketingPlanVersion,
  listMarketingPlanVersions,
  type MarketingPlanRow,
  type MarketingPlanVersionRow,
} from "@/db/marketing-plans";
import { labelOfTopic } from "@/lib/business-facts";
import { canManageMarketingStrategy } from "@/lib/cofounder/permissions";
import type { FormResult } from "@/lib/form-result";
import { PLAN_VERSIONS_SHOWN } from "@/lib/marketing-plan/limits";
import { readStoredMarketingPlan } from "@/lib/marketing-plan/plan-answer";
import type { ConfirmedFact } from "@/lib/marketing-plan/plan-prompt";
import { findMissingPlanFacts, type MissingPlanFact } from "@/lib/marketing-plan/plan-readiness";
import type { MarketingPlan } from "@/lib/marketing-plan/plan-schema";
import type { SessionContext } from "@/lib/session";
import { planVersionSchema, supportTrendsSettingSchema } from "@/lib/validation/marketing-plan";
import { getConfirmedFactsForSession } from "./marketing-plan-inputs";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// The Co-Founder's Strategy page (step 37): the current marketing plan, its
// older versions, whether a new one can be made, and the support-trends
// setting. Members read all of it; only owners make plans and change the
// setting (checked here for a clear message, and again in /db, locked, in
// the transaction that writes). Making a plan: services/marketing-plan.ts.

export type { MissingPlanFact };
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

// facts_used as stored: anything else reads as no facts.
const factsUsedSchema = z.array(z.object({ topic: z.string(), value: z.string() }));

const onlyOwners: FormResult = { ok: false, errors: { message: "Only owners can change what the Co-Founder reads." } };

// Reads the session company's Strategy page.
export async function getStrategyPageForSession(session: SessionContext): Promise<MarketingStrategy> {
  const [newest, versions, facts, usesSupportTrends] = await Promise.all([
    getNewestMarketingPlan(session.companyId),
    listMarketingPlanVersions(session.companyId, PLAN_VERSIONS_SHOWN),
    getConfirmedFactsForSession(session),
    getSupportTrendsSetting(session.companyId),
  ]);
  return {
    current: newest ? await toShownPlan(session.companyId, newest, facts) : null,
    newestVersion: newest?.version ?? 0,
    versions,
    missingForPlan: findMissingPlanFacts(new Set(facts.map((fact) => fact.topic))),
    usesSupportTrends,
  };
}

// One version of the session company's plan, by the number in the address
// (only a claim): null when the company has no such version.
export async function getPlanVersionForSession(session: SessionContext, versionParam: unknown): Promise<PlanVersionPage | null> {
  const version = planVersionSchema.safeParse(versionParam);
  if (!version.success) {
    return null;
  }
  const [row, newestVersion, facts] = await Promise.all([
    getMarketingPlanVersion(session.companyId, version.data),
    getNewestMarketingPlanVersion(session.companyId),
    getConfirmedFactsForSession(session),
  ]);
  return row ? { plan: await toShownPlan(session.companyId, row, facts), newestVersion } : null;
}

// Turns the session company's support-trends setting on or off. Owners
// only, within the settings-changes limit.
export async function setSupportTrendsForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = supportTrendsSettingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "The setting could not be read. Reload the page and try again." } };
  }
  if (!canManageMarketingStrategy(session.role)) {
    return onlyOwners;
  }
  if (await isOverRateLimit("settings-changes", session.userId, RATE_LIMITS.settingsChangesPerUser)) {
    return { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };
  }
  const outcome = await setSupportTrendsSetting(session.companyId, session.userId, parsed.data.useSupportTrends);
  return outcome === "not-allowed" ? onlyOwners : { ok: true };
}

// A stored version as the page shows it. Every field named: the page gets
// what it shows, nothing else.
async function toShownPlan(companyId: string, row: MarketingPlanRow, currentFacts: ConfirmedFact[]): Promise<ShownPlan> {
  const parsedFacts = factsUsedSchema.safeParse(row.factsUsed);
  const factsUsed = parsedFacts.success ? parsedFacts.data : [];
  const titles = await getKnowledgeArticleTitles(companyId, row.knowledgeUsed);
  return {
    version: row.version,
    createdAt: row.createdAt,
    createdByName: row.createdByName,
    goalNote: row.goalNote,
    content: readStoredMarketingPlan(row.plan, new Set(factsUsed.map((fact) => fact.topic))),
    factsUsed: factsUsed.map((fact) => ({ topic: fact.topic, label: labelOfTopic(fact.topic), value: fact.value })),
    knowledgeUsed: row.knowledgeUsed.map((articleId) => ({ articleId, title: titles.get(articleId) ?? null })),
    usedSupportTrends: row.usedSupportTrends,
    pastPerformance: row.pastPerformance,
    profileChangedSince: !hasTheSameFacts(factsUsed, currentFacts),
  };
}

// True when the confirmed facts now are exactly the ones a plan was made from.
function hasTheSameFacts(used: { topic: string; value: string }[], current: ConfirmedFact[]): boolean {
  if (used.length !== current.length) {
    return false;
  }
  const currentValues = new Map<string, string>(current.map((fact) => [fact.topic, fact.value]));
  return used.every((fact) => currentValues.get(fact.topic) === fact.value);
}
