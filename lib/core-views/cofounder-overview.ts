import "server-only";
import { callCore } from "@/lib/core-api";
import type { CoFounderOverview } from "@/lib/types/cofounder-overview";

// The Co-Founder Overview through the new backend (core's GET
// /api/v1/cofounder/overview), in the shape the page already reads: how
// complete the business profile is, the next steps (owners only: core sends
// none to members), where the marketing plan stands, and the Getting
// started checklist.

// Dates come as ISO text.
type CoreStrategy = Omit<CoFounderOverview["strategy"], "currentPlan"> & { currentPlan: { version: number; createdAt: string } | null };
type CoreOverview = Omit<CoFounderOverview, "strategy"> & { strategy: CoreStrategy };

export async function getCoFounderOverviewFromCore(): Promise<CoFounderOverview> {
  const answer = await callCore<CoreOverview>("GET", "/api/v1/cofounder/overview");
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  const overview = answer.data;
  const currentPlan = overview.strategy.currentPlan;
  return {
    completion: overview.completion,
    missingKeyTopics: overview.missingKeyTopics ?? [],
    interviewStarted: overview.interviewStarted,
    interviewFinished: overview.interviewFinished,
    nextSteps: overview.nextSteps ?? [],
    strategy: {
      currentPlan: currentPlan ? { version: currentPlan.version, createdAt: new Date(currentPlan.createdAt) } : null,
      missingForPlan: overview.strategy.missingForPlan ?? [],
    },
    checklist: overview.checklist ?? [],
  };
}
