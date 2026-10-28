import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { canReviewPerformance } from "@/lib/cofounder/permissions";
import type { PerformanceReview } from "@/lib/performance-review/review-answer";
import type { ReviewInput } from "@/lib/performance-review/review-input";
import { db } from "./client";
import { lockActiveAuthorRole } from "./knowledge-author";
import { performanceReviews, users } from "./schema";

// One company's performance reviews (step 42): saving one an owner asked
// for, and reading the newest back (the Analytics page, the marketing
// planner). Only an active owner saves one: the role is read again, locked,
// in the transaction that writes (db/knowledge-author.ts says why).

export type NewPerformanceReview = { periodStart: Date; periodEnd: Date; input: ReviewInput; review: PerformanceReview };

export type PerformanceReviewRow = {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  // As stored: lib/performance-review/stored-review.ts reads both.
  inputSummary: unknown;
  review: unknown;
  createdAt: Date;
  // Who asked for it, read within the company.
  createdByName: string | null;
};

// Saves a review of one company made for actorUserId, while they are still
// an active owner. Every column named, never a spread of what was passed.
export async function savePerformanceReview(
  companyId: string,
  actorUserId: string,
  newReview: NewPerformanceReview,
): Promise<{ outcome: "saved"; id: string } | { outcome: "not-allowed" }> {
  return db.transaction(async (tx) => {
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    if (!role || !canReviewPerformance(role)) {
      return { outcome: "not-allowed" };
    }
    const [saved] = await tx
      .insert(performanceReviews)
      .values({
        companyId,
        periodStart: newReview.periodStart,
        periodEnd: newReview.periodEnd,
        inputSummary: newReview.input,
        review: newReview.review,
        createdByUserId: actorUserId,
      })
      .returning({ id: performanceReviews.id });
    return { outcome: "saved", id: saved.id };
  });
}

// One company's newest review (undefined: none yet).
export async function getNewestPerformanceReview(companyId: string): Promise<PerformanceReviewRow | undefined> {
  const [row] = await db
    .select({
      id: performanceReviews.id,
      periodStart: performanceReviews.periodStart,
      periodEnd: performanceReviews.periodEnd,
      inputSummary: performanceReviews.inputSummary,
      review: performanceReviews.review,
      createdAt: performanceReviews.createdAt,
      createdByName: users.name,
    })
    .from(performanceReviews)
    // company_id matched too, so a name from another company can never show up.
    .leftJoin(users, and(eq(users.id, performanceReviews.createdByUserId), eq(users.companyId, performanceReviews.companyId)))
    .where(eq(performanceReviews.companyId, companyId))
    .orderBy(desc(performanceReviews.createdAt), desc(performanceReviews.id))
    .limit(1);
  return row;
}
