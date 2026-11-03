// The screens' own checks: they read the pages' source and the pure lib
// files the browser runs (no database, no backend, no network). The rules
// behind every page live in core and are proved by core's tests
// (core/: make check) and the brain's (brain/: pytest).
import { getFailureCount } from "./screen-checks/check";
import { runCofounderConsistencyChecks } from "./screen-checks/cofounder-consistency-checks";
import { runContentRulesChecks } from "./screen-checks/content-rules-checks";
import { runContentRulesVectorChecks } from "./screen-checks/content-rules-vector-checks";
import { runInboxChecks } from "./screen-checks/inbox-checks";
import { runLoginRedirectChecks } from "./screen-checks/login-redirect-checks";
import { runMediaUiChecks } from "./screen-checks/media-ui-checks";
import { runMenuChecks } from "./screen-checks/menu-checks";
import { runNavigationChecks } from "./screen-checks/navigation-checks";
import { runPackageChecks } from "./screen-checks/package-checks";
import { runPageHeadingChecks } from "./screen-checks/page-heading-checks";
import { runPracticePhoneChecks } from "./screen-checks/practice-phone-checks";
import { runSocialPageChecks } from "./screen-checks/social-page-checks";
import { runUiPolishChecks } from "./screen-checks/ui-polish-checks";
import { runWebsiteChecks } from "./screen-checks/website-checks";

async function main() {
  await runPageHeadingChecks();
  await runNavigationChecks();
  await runInboxChecks();
  await runLoginRedirectChecks();
  await runUiPolishChecks();
  await runCofounderConsistencyChecks();
  await runMediaUiChecks();
  await runMenuChecks();
  await runSocialPageChecks();
  await runPracticePhoneChecks();
  await runContentRulesChecks();
  await runContentRulesVectorChecks();
  await runWebsiteChecks();
  await runPackageChecks();
  const failures = getFailureCount();
  console.log(failures === 0 ? "\nAll screen checks passed." : `\n${failures} screen check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
