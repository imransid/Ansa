import type { BusinessFactTopic } from "@/lib/business-facts";
import type { FormErrors } from "@/lib/form-result";
import type { InterviewMessage } from "@/lib/types/onboarding-turn";

// The Co-Founder's interview (step 36) as its page shows it, and what an
// answer gives back to its form.

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
