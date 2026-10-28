// Every step 43 check (one product: the navigation, the dashboard's Business
// overview, the Co-Founder Overview's checklist, the Co-Founder pages'
// shared rules, the schema's company keys, the docs, and the end-to-end
// journey), in one place, so the runner (scripts/check-tenant-isolation.ts)
// calls them with one line. A stand-in for Claude and the development
// stand-in account only: no check reaches Anthropic or a platform.

import { runBusinessOverviewChecks } from "./business-overview-checks";
import { runCofounderChecklistChecks } from "./cofounder-checklist-checks";
import { runCofounderConsistencyChecks } from "./cofounder-consistency-checks";
import { runDocsChecks } from "./docs-checks";
import { runJourneyChecks } from "./journey-checks";
import { runNavigationChecks } from "./navigation-checks";
import { runSchemaChecks } from "./schema-checks";
import { removeStandInPostFiles } from "./social-helpers";

export async function runOneProductChecks() {
  try {
    await runNavigationChecks();
    await runBusinessOverviewChecks();
    await runCofounderChecklistChecks();
    await runCofounderConsistencyChecks();
    await runSchemaChecks();
    await runDocsChecks();
    await runJourneyChecks();
  } finally {
    // The stand-in's files the checks wrote (the rows go with the companies).
    await removeStandInPostFiles();
  }
}
