// Saves made-up numbers for a post the development stand-in "published"
// (step 42), so the Analytics page and "Review performance" can be tried
// before any platform gives real ones. Labeled "Simulated (development)"
// wherever they show. A post to a real account is refused (its numbers come
// from its platform), and so is any number its platform doesn't have.
// It writes to the database directly, so, like the checks, it only runs
// against a local database with every outside service off.
//
// Run with: pnpm simulate:post-metrics <publish job id> views=120 reactions=8 ...
// The Analytics page shows each stand-in post's id with this command. The
// app doesn't need to be running.

import { db } from "@/db/client";
import { env } from "@/lib/env";
import { simulatePostMetrics, SIMULATE_USAGE } from "@/services/post-metrics-simulation";
import { findReasonNotToRunChecks } from "./tenant-isolation/local-only";

async function main() {
  const reasonNotToRun = findReasonNotToRunChecks(process.env);
  if (reasonNotToRun) {
    console.error(`Refusing to run (this writes made-up numbers into the database): ${reasonNotToRun}`);
    process.exitCode = 1;
    return;
  }
  const [jobId, ...metricArguments] = process.argv.slice(2);
  if (!jobId || metricArguments.length === 0) {
    console.error(SIMULATE_USAGE);
    process.exitCode = 1;
    return;
  }
  const result = await simulatePostMetrics(jobId, metricArguments);
  if (!result.ok) {
    console.error(result.message);
    process.exitCode = 1;
    return;
  }
  const saved = Object.entries(result.values).map(([name, value]) => `${name}=${value}`).join(" ");
  console.log(`Saved simulated numbers (${saved}). See them on ${env.BETTER_AUTH_URL}/cofounder/analytics`);
}

main()
  .catch((error) => {
    console.error(`simulate:post-metrics failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
