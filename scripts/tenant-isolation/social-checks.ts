// Every social account check (step 40), in one place, so the runner
// (scripts/check-tenant-isolation.ts) calls them with one line. Fake
// platforms only: no check ever reaches LinkedIn, Facebook, X or Google.

import { runSocialAdapterChecks } from "./social-adapter-checks";
import { runSocialAdapterMoreChecks } from "./social-adapter-more-checks";
import { runSocialConnectionChecks } from "./social-connection-checks";
import { removeStandInPostFiles } from "./social-helpers";
import { runSocialLifetimeChecks } from "./social-lifetime-checks";
import { runSocialPageChecks } from "./social-page-checks";
import { runSocialRefreshChecks } from "./social-refresh-checks";
import { runSocialRenewalChecks } from "./social-renewal-checks";
import { runSocialRevokeChecks } from "./social-revoke-checks";
import { runSocialRuleChecks } from "./social-rule-checks";
import { runSocialStandInChecks } from "./social-stand-in-checks";
import { runSocialStateChecks } from "./social-state-checks";

export async function runSocialChecks() {
  try {
    await runSocialStateChecks();
    await runSocialConnectionChecks();
    await runSocialRevokeChecks();
    await runSocialRuleChecks();
    await runSocialAdapterChecks();
    await runSocialAdapterMoreChecks();
    await runSocialRefreshChecks();
    await runSocialRenewalChecks();
    await runSocialLifetimeChecks();
    await runSocialStandInChecks();
    await runSocialPageChecks();
  } finally {
    // The stand-in's files the checks wrote (the rows go with the companies).
    await removeStandInPostFiles();
  }
}
