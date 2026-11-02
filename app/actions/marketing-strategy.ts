"use server";

import { revalidatePath } from "next/cache";
import { makePlanThroughCore, setSupportTrendsThroughCore } from "@/lib/core-views/cofounder-strategy";
import type { SaveState } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import type { MarketingPlanResult } from "@/lib/types/marketing-plan";

// Server actions are public POST endpoints. Keep them thin: read the form, ask
// core (which checks company, role, input and rate limits), refresh the
// Co-Founder's pages.

// What "Make a new plan" shows after it ran: the new version, or why not.
export type MarketingPlanState = { result?: MarketingPlanResult };

export async function makeMarketingPlanAction(_previous: MarketingPlanState | undefined, formData: FormData): Promise<MarketingPlanState> {
  await requireSessionContext();
  const goalNote = formData.get("goalNote");
  const result = await makePlanThroughCore(goalNote);
  if (result.ok) {
    refreshCoFounderPages();
  }
  return { result };
}

export async function setSupportTrendsAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  await requireSessionContext();
  const useSupportTrends = formData.get("useSupportTrends");
  const result = await setSupportTrendsThroughCore(useSupportTrends);
  if (!result.ok) {
    return { errors: result.errors };
  }
  refreshCoFounderPages();
  return { saved: true };
}

// Every page under /cofounder: the Overview names the current plan, and
// each version's page links to the newest.
function refreshCoFounderPages(): void {
  revalidatePath("/cofounder", "layout");
}
