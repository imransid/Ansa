// Every content studio check (step 38), in one place, so the runner
// (scripts/check-tenant-isolation.ts) calls them with one line.

import { runContentDraftChangeChecks } from "./content-draft-change-checks";
import { runContentDraftChecks } from "./content-draft-checks";
import { runContentDraftReviewChecks } from "./content-draft-review-checks";
import { runContentGenerationChecks } from "./content-generation-checks";
import { runContentPromptChecks } from "./content-prompt-checks";
import { runContentRulesChecks } from "./content-rules-checks";
import { runContentStudioPageChecks } from "./content-studio-page-checks";
import { runContentTextChecks } from "./content-text-checks";

export async function runContentStudioChecks() {
  await runContentRulesChecks();
  await runContentDraftChecks();
  await runContentDraftReviewChecks();
  await runContentDraftChangeChecks();
  await runContentGenerationChecks();
  await runContentPromptChecks();
  await runContentStudioPageChecks();
  await runContentTextChecks();
}
