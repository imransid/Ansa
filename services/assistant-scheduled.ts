import "server-only";
import { runDueAssistantReplies, type AssistantDueCounts } from "./assistant-due";
import { runDuePosts } from "./autopost-runs";

// What ansa does on its own in the scheduled runs (/api/cron/publish and
// the daily job): first the people waiting for an answer you didn't give in
// time (step 51), then the next "Post for me" posts (step 54), each only
// while it still fits the run's time.
export async function runAssistantScheduledWork(jobStartedAt: number): Promise<AssistantDueCounts & { postsWritten: number }> {
  const due = await runDueAssistantReplies(jobStartedAt);
  const postsWritten = await runDuePosts(jobStartedAt);
  return { ...due, postsWritten };
}
