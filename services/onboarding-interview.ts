import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { askClaudeForOnboardingTurn } from "@/adapters/claude";
import { deleteInterviewMessages, getNewestInterviewMessages, saveInterviewAnswer, saveInterviewReply } from "@/db/onboarding-messages";
import { BUSINESS_FACT_TOPICS, type BusinessFactTopic } from "@/lib/business-facts";
import { INTERVIEW_MESSAGES_SHOWN } from "@/lib/cofounder/limits";
import { buildInterviewReply, buildOpeningMessage } from "@/lib/cofounder/interview-reply";
import { canManageBusinessProfile } from "@/lib/cofounder/permissions";
import { firstMissingKeyTopic } from "@/lib/cofounder/profile-status";
import { encryptText } from "@/lib/encryption";
import { onboardingMessageContext } from "@/lib/encryption-contexts";
import type { FormErrors, FormResult } from "@/lib/form-result";
import type { ModelAsker } from "@/lib/model-request";
import type { SessionContext } from "@/lib/session";
import { interviewAnswerSchema } from "@/lib/validation/cofounder";
import { getFactValuesForSession } from "./business-profile";
import { askClaudeForInterviewTurn, decryptInterviewMessage, type InterviewMessage } from "./onboarding-turn";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// The Co-Founder's interview (step 36): one question at a time, Claude
// proposing facts from the owner's answers (services/onboarding-turn.ts).
// Without Claude it still goes on, with the fixed question for the first key
// topic still missing.
//
// LOGGING RULE for this file: never log an answer, a question or any error
// message. Fixed strings and class names only.

export type { InterviewMessage };

export type Interview = {
  // The newest INTERVIEW_MESSAGES_SHOWN, oldest first.
  messages: InterviewMessage[];
  olderMessagesHidden: boolean;
  // While the interview has no message: its first question (fixed text,
  // saved with the first answer) and the topic it asks about. Null once it
  // has started.
  opening: { topic: BusinessFactTopic | null; text: string } | null;
  // The Co-Founder's newest message closed the interview, and no key topic
  // is missing now.
  finished: boolean;
};

type TopicLabel = { topic: BusinessFactTopic; label: string };

export type InterviewAnswerResult =
  | { ok: true; proposedTopics: TopicLabel[]; aiReadAnswer: boolean; fixedQuestionTopic: TopicLabel | null }
  | { ok: false; errors: FormErrors };

const STARTED_OVER =
  "The interview was started over while you answered, so your answer was not saved. Reload the page to see its first question.";

// Reads the session company's interview for its page, decrypted.
export async function getInterviewForSession(session: SessionContext): Promise<Interview> {
  // One more than shown, to know whether older messages are left out.
  const [newestFirst, facts] = await Promise.all([
    getNewestInterviewMessages(session.companyId, INTERVIEW_MESSAGES_SHOWN + 1),
    getFactValuesForSession(session),
  ]);
  const newestReply = newestFirst.find((row) => row.author === "assistant");
  const missingTopic = firstMissingKeyTopic(facts);
  return {
    messages: newestFirst.slice(0, INTERVIEW_MESSAGES_SHOWN).reverse().map((row) => decryptInterviewMessage(session.companyId, row)),
    olderMessagesHidden: newestFirst.length > INTERVIEW_MESSAGES_SHOWN,
    opening: newestFirst.length === 0 ? { topic: missingTopic, text: buildOpeningMessage(missingTopic) } : null,
    // WHY "nothing missing" too: a key proposal dismissed after the closing
    // message makes its topic missing again, and the interview goes on.
    finished: (newestReply?.endsInterview ?? false) && missingTopic === null,
  };
}

// Saves the logged-in owner's answer, asks Claude for the facts it holds and
// the next question, and saves both. The answer is saved first, so it is
// kept even when Claude fails. askModel is only replaced by the checks.
export async function answerInterviewForSession(
  session: SessionContext,
  input: unknown,
  askModel: ModelAsker = askClaudeForOnboardingTurn,
): Promise<InterviewAnswerResult> {
  const parsed = interviewAnswerSchema.safeParse(input);
  if (!parsed.success) {
    return answerFormErrors(parsed.error);
  }
  if (!canManageBusinessProfile(session.role)) {
    return notAnOwner();
  }
  // Per company: every owner's answer is a paid Claude call.
  if (await isOverRateLimit("onboarding-turns", session.companyId, RATE_LIMITS.onboardingTurnsPerCompany)) {
    return { ok: false, errors: { message: "Your company has answered a lot of questions this hour. Wait a while and try again." } };
  }
  const { answer, openingTopic } = parsed.data;
  const answerId = randomUUID();
  const opening = openingTopic === undefined ? null : buildOpeningMessage(openingTopic === "none" ? null : openingTopic);
  const saved = await saveInterviewAnswer(session.companyId, session.userId, {
    opening: opening === null ? null : encryptMessage(session.companyId, opening),
    answer: { id: answerId, bodyEncrypted: encryptText(answer, onboardingMessageContext(session.companyId, answerId)) },
  });
  if (saved !== "saved") {
    return saved === "not-allowed" ? notAnOwner() : { ok: false, errors: { message: STARTED_OVER } };
  }

  const facts = await getFactValuesForSession(session);
  const reply = buildInterviewReply(await askClaudeForInterviewTurn(session.companyId, facts, askModel), facts);
  const result = await saveInterviewReply(session.companyId, session.userId, {
    answerId,
    message: encryptMessage(session.companyId, reply.text),
    endsInterview: reply.endsInterview,
    proposals: reply.proposals,
  });
  if (result.outcome === "not-allowed") {
    return notAnOwner();
  }
  if (result.outcome === "started-over") {
    return { ok: false, errors: { message: "The interview was started over while the AI read your answer, so nothing was saved from it." } };
  }
  return {
    ok: true,
    proposedTopics: result.proposedTopics.map(topicLabel),
    aiReadAnswer: reply.aiReadAnswer,
    fixedQuestionTopic: reply.fixedQuestionTopic ? topicLabel(reply.fixedQuestionTopic) : null,
  };
}

// "Start over": deletes the session company's interview, never its facts.
// Owners only, within the business-profile-changes limit.
export async function startOverInterviewForSession(session: SessionContext): Promise<FormResult> {
  const onlyOwners: FormResult = { ok: false, errors: { message: "Only owners can start the interview over." } };
  if (!canManageBusinessProfile(session.role)) {
    return onlyOwners;
  }
  if (await isOverRateLimit("business-profile-changes", session.userId, RATE_LIMITS.businessProfileChangesPerUser)) {
    return { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };
  }
  if ((await deleteInterviewMessages(session.companyId, session.userId)) === "not-allowed") {
    return onlyOwners;
  }
  return { ok: true };
}

// A message of the Co-Founder, with its own new id, encrypted: the context
// names the company and the message.
function encryptMessage(companyId: string, text: string) {
  const id = randomUUID();
  return { id, bodyEncrypted: encryptText(text, onboardingMessageContext(companyId, id)) };
}

// The answer's own problems go under the box; a changed hidden field gets a
// plain message.
function answerFormErrors(error: z.ZodError): InterviewAnswerResult {
  const answerErrors = z.flattenError(error).fieldErrors as Record<string, string[] | undefined>;
  if (answerErrors.answer) {
    return { ok: false, errors: { fieldErrors: { answer: answerErrors.answer } } };
  }
  return { ok: false, errors: { message: "Your answer could not be sent. Reload the page and try again." } };
}

function topicLabel(topic: BusinessFactTopic): TopicLabel {
  return { topic, label: BUSINESS_FACT_TOPICS[topic].label };
}

function notAnOwner(): { ok: false; errors: FormErrors } {
  return { ok: false, errors: { message: "Only owners answer the interview." } };
}
