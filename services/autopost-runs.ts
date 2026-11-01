import "server-only";
import { AUTOPOST_SETTINGS, longestRequestMs } from "@/adapters/claude-settings";
import { listCompaniesPostingForThem, postingTimeTaken } from "@/db/autopost";
import { postingTimeToWrite } from "@/lib/autopost/schedule";
import { describeErrorWithFrames } from "@/lib/safe-error-logging";
import { writePostFor, type WriterOptions } from "./autopost-writer";

// The scheduled runs' part of "Post for me" (step 54): for every company
// that has it on (the one read across companies, db/autopost.ts), the next
// posting time within a day gets its post written now, once (claimed).
// A post is started only while its slowest run (two AI tries and the
// database) still ends inside the route's 300 seconds; at most a few per
// run, the others wait for the next run.

const RUN_BUDGET_MS = 300_000;
const LONGEST_POST_RUN_MS = 2 * longestRequestMs(AUTOPOST_SETTINGS) + 20_000;
const POSTS_PER_RUN = 10;

// `onlyCompanyId`: the checks write for their own company only.
export async function runDuePosts(jobStartedAt: number, options: WriterOptions = {}, onlyCompanyId?: string, now = new Date()): Promise<number> {
  let written = 0;
  for (const company of await listCompaniesPostingForThem()) {
    if (onlyCompanyId && company.companyId !== onlyCompanyId) {
      continue;
    }
    if (written >= POSTS_PER_RUN || Date.now() - jobStartedAt + LONGEST_POST_RUN_MS > RUN_BUDGET_MS) {
      console.warn("Post for me run stopped at its time limit / batch size: posts are left for the next run");
      break;
    }
    const postAt = postingTimeToWrite(company.frequency, company.time, company.timeZone, now);
    if (!postAt || (await postingTimeTaken(company.companyId, postAt))) {
      continue;
    }
    try {
      const outcome = await writePostFor(company, postAt, options);
      written += outcome.outcome === "taken" ? 0 : 1;
    } catch (error) {
      console.error(`Post for me failed: ${describeErrorWithFrames(error)}`);
    }
  }
  return written;
}
