"use server";

import { revalidatePath } from "next/cache";
import { requireSessionContext } from "@/lib/session";
import { reviewPerformanceForSession, type PerformanceReviewResult } from "@/services/performance-review";

// Server actions are public POST endpoints. Keep them thin: read the form,
// call a service (which checks company, role, input and rate limits),
// refresh the Co-Founder's pages.

// "Review performance": the period the page showed, and the browser's own
// timezone (its onSubmit adds it).
export async function reviewPerformanceAction(_previous: PerformanceReviewResult | undefined, formData: FormData): Promise<PerformanceReviewResult> {
  const session = await requireSessionContext();
  const result = await reviewPerformanceForSession(session, { period: formData.get("period"), timeZone: formData.get("timeZone") });
  if (result.ok) {
    // The Analytics page shows the new review; the Strategy page's next plan reads it.
    revalidatePath("/cofounder", "layout");
  }
  return result;
}
