// Every publishing queue and calendar check (step 41), in one place, so the
// runner (scripts/check-tenant-isolation.ts) calls them with one line. Fake
// platforms and a stand-in for Claude only: no check reaches LinkedIn,
// Facebook, X, Google or Anthropic.

import { runPublishingActivityChecks } from "./publishing-activity-checks";
import { runPublishingClaimChecks } from "./publishing-claim-checks";
import { runPublishingCronChecks } from "./publishing-cron-checks";
import { runPublishingOutcomeChecks } from "./publishing-outcome-checks";
import { runPublishingPageChecks } from "./publishing-page-checks";
import { runPublishingRuleChecks } from "./publishing-rule-checks";
import { runPublishingRunChecks } from "./publishing-run-checks";
import { runPublishingScheduleChecks } from "./publishing-schedule-checks";
import { runPublishingTimeChecks } from "./publishing-time-checks";
import { runPublishingTurnsChecks } from "./publishing-turns-checks";
import { removeStandInPostFiles } from "./social-helpers";

export async function runPublishingChecks() {
  try {
    await runPublishingRunChecks();
    await runPublishingClaimChecks();
    await runPublishingTurnsChecks();
    await runPublishingOutcomeChecks();
    await runPublishingScheduleChecks();
    await runPublishingRuleChecks();
    await runPublishingTimeChecks();
    await runPublishingCronChecks();
    await runPublishingActivityChecks();
    await runPublishingPageChecks();
  } finally {
    // The stand-in's files the checks wrote (the rows go with the companies).
    await removeStandInPostFiles();
  }
}
