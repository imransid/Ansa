// Development only (step 51): runs once what the scheduled job does every
// minute in production: the assistant steps in for messages you didn't
// answer within your minutes (Settings → Assistant → When ansa answers).
// Handy after pnpm simulate:message or simulate:telegram while you are
// "available". Only against a local database with every outside service off.
//
// Run with: pnpm assistant:catch-up

import { db } from "@/db/client";
import { runDueAssistantReplies } from "@/services/assistant-due";
import { runDuePosts } from "@/services/autopost-runs";
import { findReasonNotToRunChecks } from "./tenant-isolation/local-only";

async function main() {
  const reasonNotToRun = findReasonNotToRunChecks(process.env);
  if (reasonNotToRun) {
    console.error(`Refusing to run: ${reasonNotToRun}`);
    process.exitCode = 1;
    return;
  }
  const counts = await runDueAssistantReplies();
  console.log(`The assistant stepped in for ${counts.answered} unanswered ${counts.answered === 1 ? "message" : "messages"} (${counts.alreadyAnswered} you had answered).`);
  // "Post for me" (step 54): the next posts within a day, written now.
  const posts = await runDuePosts(Date.now());
  console.log(`Post for me wrote ${posts} ${posts === 1 ? "post" : "posts"}.`);
}

main()
  .catch((error) => {
    console.error(`assistant:catch-up failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
