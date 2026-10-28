// Every Co-Founder check (steps 36 and 37), in one place, so the runner
// (scripts/check-tenant-isolation.ts) calls them with one line.

import { runCofounderInterviewChecks } from "./cofounder-interview-checks";
import { runCofounderInterviewControlChecks } from "./cofounder-interview-control-checks";
import { runCofounderProfileChecks } from "./cofounder-profile-checks";
import { runCofounderProfileRuleChecks } from "./cofounder-profile-rule-checks";
import { runCofounderPromptChecks } from "./cofounder-prompt-checks";
import { runCofounderSuggestionChecks } from "./cofounder-suggestion-checks";
import { runMarketingPlanAnswerChecks } from "./marketing-plan-answer-checks";
import { runMarketingPlanChecks } from "./marketing-plan-checks";
import { runMarketingPlanPageChecks } from "./marketing-plan-page-checks";
import { runMarketingPlanPromptChecks } from "./marketing-plan-prompt-checks";
import { runMarketingPlanSchemaChecks } from "./marketing-plan-schema-checks";
import { runMarketingPlanSearchChecks } from "./marketing-plan-search-checks";

export async function runCofounderChecks() {
  await runCofounderInterviewChecks();
  await runCofounderInterviewControlChecks();
  await runCofounderPromptChecks();
  await runCofounderProfileChecks();
  await runCofounderProfileRuleChecks();
  await runCofounderSuggestionChecks();
  await runMarketingPlanChecks();
  await runMarketingPlanPromptChecks();
  await runMarketingPlanSearchChecks();
  await runMarketingPlanAnswerChecks();
  await runMarketingPlanSchemaChecks();
  await runMarketingPlanPageChecks();
}
