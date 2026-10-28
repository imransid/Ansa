// Every media library check (step 39), in one place, so the runner
// (scripts/check-tenant-isolation.ts) calls them with one line.

import { runMediaAltTextChecks } from "./media-alt-text-checks";
import { runMediaDeleteChecks } from "./media-delete-checks";
import { runMediaDraftChecks } from "./media-draft-checks";
import { runMediaFileChecks } from "./media-file-checks";
import { runMediaGenerationChecks } from "./media-generation-checks";
import { runMediaJobChecks } from "./media-job-checks";
import { runMediaJobControlChecks } from "./media-job-control-checks";
import { runMediaLibraryChecks } from "./media-library-checks";
import { runMediaRequestChecks } from "./media-request-checks";
import { runMediaUiChecks } from "./media-ui-checks";

export async function runMediaChecks() {
  await runMediaFileChecks();
  await runMediaLibraryChecks();
  await runMediaGenerationChecks();
  await runMediaJobChecks();
  await runMediaJobControlChecks();
  await runMediaDraftChecks();
  await runMediaDeleteChecks();
  await runMediaAltTextChecks();
  await runMediaRequestChecks();
  await runMediaUiChecks();
}
