"use server";

import { revalidatePath } from "next/cache";
import { reviewPerformanceThroughCore } from "@/lib/core-views/analytics";
import { requireSessionContext } from "@/lib/session";
import type { PerformanceReviewResult } from "@/lib/types/performance-review";

// Server actions are public POST endpoints. Keep them thin: read the form,
// ask core (which checks company, role, input and rate limits),
// refresh the Co-Founder's pages.

// "Review performance": the period the page showed, and the browser's own
// timezone (its onSubmit adds it).
export async function reviewPerformanceAction(_previous: PerformanceReviewResult | undefined, formData: FormData): Promise<PerformanceReviewResult> {
  await requireSessionContext();
  const result = await reviewPerformanceThroughCore(formData.get("period"), formData.get("timeZone"));
  if (result.ok) {
    // The Analytics page shows the new review; the Strategy page's next plan reads it.
    revalidatePath("/cofounder", "layout");
  }
  return result;
}
