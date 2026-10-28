import "server-only";
import { getNewestInterviewMessages, type InterviewMessageRow } from "@/db/onboarding-messages";
import { INTERVIEW_MESSAGES_FOR_AI } from "@/lib/cofounder/limits";
import { buildInterviewPrompt, INTERVIEW_SYSTEM_PROMPT, type MessageForPrompt } from "@/lib/cofounder/interview-prompt";
import { buildInterviewTurnJsonSchema, readInterviewTurn, type InterviewTurn } from "@/lib/cofounder/interview-turn";
import type { FactValuesByTopic } from "@/lib/cofounder/profile-status";
import { decryptForDisplay } from "@/lib/encryption";
import { onboardingMessageContext } from "@/lib/encryption-contexts";
import { describeModelFailure } from "@/lib/model-failure";
import type { ModelAsker } from "@/lib/model-request";

// One turn of the Co-Founder's interview with Claude (step 36), and how a
// stored message is read back. The flow around it: services/onboarding-interview.ts.
//
// LOGGING RULE for this file: never log a message, the prompt, Claude's
// answer or any error message. Fixed strings and class names only.

export type InterviewMessage = {
  id: string;
  author: "assistant" | "owner";
  authorName: string | null;
  // null when it can't be decrypted (unreadable).
  text: string | null;
  unreadable: boolean;
  createdAt: Date;
};

// Decrypts one stored message of one company's interview. Every field
// named: the ciphertext never leaves the services.
export function decryptInterviewMessage(companyId: string, row: InterviewMessageRow): InterviewMessage {
  const body = decryptForDisplay(row.bodyEncrypted, onboardingMessageContext(companyId, row.id));
  return { id: row.id, author: row.author, authorName: row.authorName, text: body.text, unreadable: body.unreadable, createdAt: row.createdAt };
}

// Asks Claude about one company's newest messages (the answer just saved
// among them) with its profile, and reads the turn: null when there is no
// usable answer (not asked, refused, failed, malformed).
export async function askClaudeForInterviewTurn(companyId: string, facts: FactValuesByTopic, askModel: ModelAsker): Promise<InterviewTurn | null> {
  const newestFirst = await getNewestInterviewMessages(companyId, INTERVIEW_MESSAGES_FOR_AI);
  const messages: MessageForPrompt[] = [];
  for (const row of [...newestFirst].reverse()) {
    const message = decryptInterviewMessage(companyId, row);
    // One that can't be decrypted is left out: there is nothing to read.
    if (message.text !== null) {
      messages.push({ author: message.author, text: message.text });
    }
  }
  const result = await askModel({
    systemPrompt: INTERVIEW_SYSTEM_PROMPT,
    prompt: buildInterviewPrompt(facts, messages),
    jsonSchema: buildInterviewTurnJsonSchema(),
  });
  const failure = describeModelFailure(result);
  if (failure) {
    // One fixed line with the class: a revoked key (AuthenticationError) and
    // a wrong model name (NotFoundError) need different fixes.
    console.error(`Claude call failed: ${failure}`);
  }
  return readInterviewTurn(result);
}
