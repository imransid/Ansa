import { BUSINESS_FACT_TOPICS, type BusinessFactTopic } from "@/lib/business-facts";
import type { FactProposal } from "./fact-proposals";
import type { InterviewTurn } from "./interview-turn";
import { firstMissingKeyTopic, withProposals, type FactValuesByTopic } from "./profile-status";

// What the Co-Founder says next in the interview (step 36), decided in code
// from Claude's turn and the profile. Pure.

const INTRODUCTION =
  "Hi! I'm your AI Co-Founder. To help with your marketing I first need to know your business, so I'll ask you some questions, one at a time. What you tell me becomes proposed facts, and nothing counts until an owner confirms it on the Profile page.";

const OPENING_WHEN_COMPLETE = "Your profile already has every key fact. Is there anything about the business you'd like to add or change?";

// When every key topic is confirmed or proposed and the app answers without
// Claude: nothing more it must ask.
export const FIXED_CLOSING =
  "Every key fact is now confirmed or waiting for you on the Profile page. Is there anything else about the business you'd like to add?";

// Before the app's own question when Claude couldn't read the answer. Saved
// with it, so the conversation still says why the question came back.
export const COULD_NOT_READ_NOTE =
  "I couldn't read that answer just now, so nothing was taken from it. You can also type any fact yourself on the Profile page.";

export type InterviewReply = {
  // What is saved as the Co-Founder's message: one plain line.
  text: string;
  // The reply closes the interview: no key topic is missing.
  endsInterview: boolean;
  // What to save as proposals (none when Claude gave no usable answer).
  proposals: FactProposal[];
  // false: Claude couldn't read the answer (no key, refused, failed, an
  // unusable answer), so nothing was taken from it. The page says so.
  aiReadAnswer: boolean;
  // The key topic of the app's fixed question, when the app asked it.
  fixedQuestionTopic: BusinessFactTopic | null;
};

// The first message of an interview: fixed text, no Claude call. It asks
// about `topic`, the first key topic still missing when the page showed it
// (null: none was missing).
export function buildOpeningMessage(topic: BusinessFactTopic | null): string {
  return `${INTRODUCTION} ${topic ? BUSINESS_FACT_TOPICS[topic].question : OPENING_WHEN_COMPLETE}`;
}

// Decides the reply to an owner's answer. Without a usable turn (null) the
// app asks its fixed question for the first key topic still missing, and
// proposes nothing. Claude may end the interview only when no key topic is
// missing once its proposals are counted: ending early would leave the
// owner thinking the profile is done, so the fixed question is asked instead
// (Claude's proposals are still saved).
export function buildInterviewReply(turn: InterviewTurn | null, facts: FactValuesByTopic): InterviewReply {
  if (!turn) {
    const missing = firstMissingKeyTopic(facts);
    const question = missing ? BUSINESS_FACT_TOPICS[missing].question : FIXED_CLOSING;
    return {
      text: `${COULD_NOT_READ_NOTE} ${question}`,
      endsInterview: missing === null,
      proposals: [],
      aiReadAnswer: false,
      fixedQuestionTopic: missing,
    };
  }
  const missing = firstMissingKeyTopic(withProposals(facts, turn.proposals));
  if (turn.interviewComplete && missing) {
    return {
      text: BUSINESS_FACT_TOPICS[missing].question,
      endsInterview: false,
      proposals: turn.proposals,
      aiReadAnswer: true,
      fixedQuestionTopic: missing,
    };
  }
  return {
    text: turn.nextQuestion,
    endsInterview: turn.interviewComplete,
    proposals: turn.proposals,
    aiReadAnswer: true,
    fixedQuestionTopic: null,
  };
}
