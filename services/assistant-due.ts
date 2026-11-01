import "server-only";
import { ASSISTANT_REPLY_SETTINGS, longestRequestMs } from "@/adapters/claude-settings";
import { claimDueConversation, newestCustomerMessageAndAnswer } from "@/db/assistant-due";
import { runAssistantReply, type AssistantRunOptions } from "./assistant-reply";

// "If I haven't answered within N minutes" (step 51): the scheduled runs
// (/api/cron/publish every minute, the daily job, and pnpm telegram:poll in
// development) take the conversations whose minutes are up, one at a time,
// and let the assistant answer the newest message, unless you answered it
// yourself meanwhile (in ansa or in your own Telegram app). Each run starts
// one only while its slowest answer still ends inside the route's 300 s.

export type AssistantDueCounts = { answered: number; alreadyAnswered: number };

const RUN_BUDGET_MS = 300_000;
// One answer at its slowest: every Claude try timing out, or Claude Code's
// 90 s, plus the database, the reply and the alerts.
const LONGEST_ASSISTANT_RUN_MS = Math.max(longestRequestMs(ASSISTANT_REPLY_SETTINGS), 90_000) + 20_000;
const MAX_PER_RUN = 50;

// `options` and `onlyCompanyId` are only passed by the checks (a fake model
// and fake channels, for their own company only).
export async function runDueAssistantReplies(
  jobStartedAt: number = Date.now(),
  options: AssistantRunOptions = {},
  onlyCompanyId?: string,
): Promise<AssistantDueCounts> {
  const counts: AssistantDueCounts = { answered: 0, alreadyAnswered: 0 };
  for (let run = 0; run < MAX_PER_RUN; run++) {
    if (Date.now() - jobStartedAt + LONGEST_ASSISTANT_RUN_MS > RUN_BUDGET_MS) {
      console.warn("Assistant catch-up stopped at its time limit: conversations are left for the next run");
      break;
    }
    const due = await claimDueConversation(onlyCompanyId);
    if (!due) {
      break;
    }
    const newest = await newestCustomerMessageAndAnswer(due.companyId, due.conversationId);
    if (!newest || newest.answered) {
      counts.alreadyAnswered++;
      continue;
    }
    await runAssistantReply({ ...due, triggerMessageId: newest.messageId }, { ...options, settleMs: 0, coverAfterNoReply: true });
    counts.answered++;
  }
  return counts;
}
