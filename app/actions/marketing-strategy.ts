"use server";

import { revalidatePath } from "next/cache";
import { isCoreOn } from "@/lib/core-api";
import { makePlanThroughCore, setSupportTrendsThroughCore } from "@/lib/core-views/cofounder-strategy";
import type { SaveState } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import type { MarketingPlanResult } from "@/lib/types/marketing-plan";
import { makeMarketingPlanForSession } from "@/services/marketing-plan";
import { setSupportTrendsForSession } from "@/services/marketing-strategy";

// Server actions are public POST endpoints. Keep them thin: read the form,
// call a service (which checks company, role, input and rate limits),
// refresh the Co-Founder's pages. Each uses the new backend when it is
// switched on (lib/core-api.ts), else services/.

// What "Make a new plan" shows after it ran: the new version, or why not.
export type MarketingPlanState = { result?: MarketingPlanResult };

export async function makeMarketingPlanAction(_previous: MarketingPlanState | undefined, formData: FormData): Promise<MarketingPlanState> {
  const session = await requireSessionContext();
  const goalNote = formData.get("goalNote");
  const result = isCoreOn() ? await makePlanThroughCore(goalNote) : await makeMarketingPlanForSession(session, { goalNote });
  if (result.ok) {
    refreshCoFounderPages();
  }
  return { result };
}

export async function setSupportTrendsAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  const session = await requireSessionContext();
  const useSupportTrends = formData.get("useSupportTrends");
  const result = isCoreOn() ? await setSupportTrendsThroughCore(useSupportTrends) : await setSupportTrendsForSession(session, { useSupportTrends });
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
