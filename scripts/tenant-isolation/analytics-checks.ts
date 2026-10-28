// Every analytics check (step 42), in one place, so the runner
// (scripts/check-tenant-isolation.ts) calls them with one line: the
// definitions, the adapters, the collector, the simulate command, the
// Analytics page and the performance review. Fake platforms and a stand-in
// for Claude only: no check reaches LinkedIn, Facebook, X, Google or
// Anthropic.

import { runAnalyticsPageChecks } from "./analytics-page-checks";
import { runClaudeAdapterReviewChecks } from "./claude-adapter-review-checks";
import { runMetricsAdapterChecks } from "./metrics-adapter-checks";
import { runMetricsCollectionChecks } from "./metrics-collection-checks";
import { runMetricsDefinitionChecks } from "./metrics-definition-checks";
import { runMetricsReadWindowChecks } from "./metrics-read-window-checks";
import { runMetricsSimulationChecks } from "./metrics-simulation-checks";
import { runPerformanceReviewAnswerChecks } from "./performance-review-answer-checks";
import { runPerformanceReviewChecks } from "./performance-review-checks";
import { runPerformanceReviewTextChecks } from "./performance-review-text-checks";
import { removeStandInPostFiles } from "./social-helpers";

export async function runAnalyticsChecks() {
  try {
    await runMetricsDefinitionChecks();
    await runMetricsAdapterChecks();
    await runMetricsCollectionChecks();
    await runMetricsReadWindowChecks();
    await runMetricsSimulationChecks();
    await runAnalyticsPageChecks();
    await runPerformanceReviewChecks();
    await runPerformanceReviewAnswerChecks();
    await runPerformanceReviewTextChecks();
    await runClaudeAdapterReviewChecks();
  } finally {
    // The stand-in's files the checks wrote (the rows go with the companies).
    await removeStandInPostFiles();
  }
}
