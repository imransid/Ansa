// Post number checks (step 42), the definitions and the database: every
// platform says, for each number ansa keeps, whether it gives it, from
// which field, and what it means; Postgres keeps snapshots to the rules
// (another company's post, a negative count, no number at all, an unknown
// source refused), and its lists agree with the code's.

import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { marketingPlans, performanceReviews, postMetrics, publishJobs } from "@/db/schema";
import { postMetricSources } from "@/lib/analytics/kinds";
import { collectedColumns, METRIC_DEFINITIONS, METRIC_LABELS, metricColumns, platformsCollectingMetrics } from "@/lib/metric-definitions";
import { metricsErrorCodes } from "@/lib/metrics-errors";
import { socialPlatforms } from "@/lib/social-platforms";
import { approvedTextPost, standInPost } from "./analytics-helpers";
import { makeReadyForDrafts } from "./content-studio-helpers";
import { assertRefusedByConstraint, check, sessionFor, signUpTestOwner } from "./helpers";
import { scheduledJobIds, standInAccount } from "./publishing-helpers";

// The values one CHECK allows, as Postgres writes it back.
async function checkListOf(table: string, constraintName: string): Promise<string[]> {
  const result = await db.execute<{ definition: string }>(
    sql`select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = ${table}::regclass and conname = ${constraintName}`,
  );
  return [...(result.rows[0]?.definition ?? "").matchAll(/'([^']*)'::text/g)].map((match) => match[1]);
}

export async function runMetricsDefinitionChecks() {
  await check("metric definitions: every platform defines all seven numbers; each it gives has its label, its field and a one-line definition, each it gives only with a permission names it, each it doesn't have says why; LinkedIn fills none (r_member_postAnalytics), so only Facebook, X and YouTube are read", async () => {
    for (const platform of socialPlatforms) {
      assert.deepEqual(Object.keys(METRIC_DEFINITIONS[platform]).sort(), [...metricColumns].sort(), platform);
      for (const column of metricColumns) {
        const definition = METRIC_DEFINITIONS[platform][column];
        assert.ok(definition.definition.length > 10 && !definition.definition.includes("\n"), `${platform} ${column} has no one-line definition`);
        if (definition.status !== "not_offered") {
          assert.ok(definition.label && definition.field, `${platform} ${column} has no label or field`);
        }
        if (definition.status === "needs_permission") {
          assert.ok(definition.permission.length > 0, `${platform} ${column} names no permission`);
        }
      }
    }
    assert.deepEqual(collectedColumns("linkedin"), []);
    assert.deepEqual(collectedColumns("facebook"), ["reactions", "comments", "shares"]);
    assert.deepEqual(collectedColumns("x"), ["views", "reactions", "comments", "shares", "clicks"]);
    assert.deepEqual(collectedColumns("youtube"), ["views", "reactions", "comments"]);
    assert.deepEqual(platformsCollectingMetrics(), ["facebook", "x", "youtube"]);
    // The research's names, as the spec's examples write them.
    assert.equal(METRIC_DEFINITIONS.facebook.views.status === "not_offered" ? "" : METRIC_DEFINITIONS.facebook.views.field, "post_media_view");
    assert.equal(METRIC_DEFINITIONS.linkedin.views.status === "not_offered" ? "" : METRIC_DEFINITIONS.linkedin.views.field, "IMPRESSION");
    assert.equal(METRIC_DEFINITIONS.x.views.status === "collected" ? METRIC_DEFINITIONS.x.views.field : "", "public_metrics.impression_count");
    assert.equal(Object.keys(METRIC_LABELS).length, metricColumns.length);
  });

  await check("post numbers: the database's CHECKs list exactly the code's sources; a job's metrics error is a code, never a message, and only on a post that went out", async () => {
    assert.deepEqual((await checkListOf("post_metrics", "post_metrics_source_known")).sort(), [...postMetricSources].sort());
    for (const code of metricsErrorCodes) {
      assert.match(code, /^[a-z0-9_]{1,60}$/);
    }
    const owner = sessionFor(await signUpTestOwner("metrics-db"));
    await makeReadyForDrafts(owner);
    const jobId = await standInPost(owner, "Database rules");
    const update = (change: Partial<typeof publishJobs.$inferInsert>) => db.update(publishJobs).set(change).where(eq(publishJobs.id, jobId));
    await assertRefusedByConstraint(update({ metricsError: "X said: Unauthorized for token abc", metricsAttemptedAt: new Date() }), "publish_jobs_metrics_error_is_code");
    await assertRefusedByConstraint(update({ metricsError: "timeout", metricsAttemptedAt: null }), "publish_jobs_metrics_error_with_attempt");
    // A post still waiting in the queue has no numbers to try for.
    const waitingDraft = await approvedTextPost(owner, "linkedin", "Database rules, waiting");
    const [waiting] = await scheduledJobIds(owner, waitingDraft, [await standInAccount(owner)]);
    const tried = db.update(publishJobs).set({ metricsAttemptedAt: new Date() }).where(eq(publishJobs.id, waiting));
    await assertRefusedByConstraint(tried, "publish_jobs_metrics_only_when_published");
  });

  await check("post numbers: Postgres refuses a snapshot of another company's post, a negative count, a snapshot without a single number and an unknown source; a review by a person of another company, and a plan pointing at another company's review", async () => {
    const ownerA = sessionFor(await signUpTestOwner("metrics-db-a"));
    const ownerB = sessionFor(await signUpTestOwner("metrics-db-b"));
    await makeReadyForDrafts(ownerA);
    const jobId = await standInPost(ownerA, "Snapshot rules");
    const row = (change: Partial<typeof postMetrics.$inferInsert>) =>
      db.insert(postMetrics).values({ companyId: ownerA.companyId, publishJobId: jobId, collectedAt: new Date(), views: 1, source: "dev_simulated", ...change });
    await assertRefusedByConstraint(row({ companyId: ownerB.companyId }), "post_metrics_job_in_same_company_fk");
    await assertRefusedByConstraint(row({ reactions: -1 }), "post_metrics_counts_not_negative");
    await assertRefusedByConstraint(row({ views: null }), "post_metrics_has_a_number");
    await assertRefusedByConstraint(row({ source: "guessed" as "platform" }), "post_metrics_source_known");
    const review = { periodStart: new Date(Date.now() - 1000), periodEnd: new Date(), inputSummary: {}, review: {} };
    await assertRefusedByConstraint(db.insert(performanceReviews).values({ ...review, companyId: ownerA.companyId, createdByUserId: ownerB.userId }), "performance_reviews_creator_in_same_company_fk");
    await assertRefusedByConstraint(
      db.insert(performanceReviews).values({ ...review, periodStart: review.periodEnd, companyId: ownerA.companyId, createdByUserId: ownerA.userId }),
      "performance_reviews_period_order",
    );
    const [reviewOfB] = await db.insert(performanceReviews).values({ ...review, companyId: ownerB.companyId, createdByUserId: ownerB.userId }).returning({ id: performanceReviews.id });
    const plan = { companyId: ownerA.companyId, version: 99, plan: {}, factsUsed: [], knowledgeUsed: [], usedSupportTrends: false, createdByUserId: ownerA.userId };
    await assertRefusedByConstraint(db.insert(marketingPlans).values({ ...plan, performanceReviewId: reviewOfB.id }), "marketing_plans_review_in_same_company_fk");
  });
}
