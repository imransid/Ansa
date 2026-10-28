import { z } from "zod";
import type { ModelResult } from "@/lib/model-request";
import { toPlainSingleLine } from "@/lib/plain-text";
import { cutToLength, PROPOSED_FACTS_JSON_SCHEMA, readProposedFacts, type FactProposal } from "./fact-proposals";
import { INTERVIEW_QUESTION_MAX_LENGTH } from "./limits";

// What Claude must return for one turn of the interview (step 36), written
// twice like the call brain: the JSON schema the API enforces, and the Zod
// schema we check the answer against. Keep the two in sync:
// scripts/tenant-isolation/cofounder-prompt-checks.ts checks it.
//
// There is deliberately no company, message or person field: Claude cannot
// choose what its answer applies to. Any extra field makes the answer
// unusable (.strict() / additionalProperties: false).

export function buildInterviewTurnJsonSchema() {
  return {
    type: "object",
    properties: {
      proposed_facts: PROPOSED_FACTS_JSON_SCHEMA,
      next_question: { type: "string" },
      interview_complete: { type: "boolean" },
    },
    required: ["proposed_facts", "next_question", "interview_complete"],
    additionalProperties: false,
  };
}

// The entries of proposed_facts are checked one by one (readProposedFacts),
// so one odd entry drops only itself. Anything else malformed (a field
// missing or extra, a question that isn't text) makes the whole answer
// unusable.
export const interviewTurnSchema = z
  .object({
    proposed_facts: z.array(z.unknown()),
    next_question: z.string(),
    interview_complete: z.boolean(),
  })
  .strict();

export type InterviewTurn = {
  proposals: FactProposal[];
  // One plain line, at most INTERVIEW_QUESTION_MAX_LENGTH characters.
  nextQuestion: string;
  interviewComplete: boolean;
};

// Turns whatever came back from Claude into a turn, or null when there is no
// usable answer: not asked (no API key), refused, cut off, failed, not JSON,
// another shape, or a blank question. The interview then goes on without it
// (lib/cofounder/interview-reply.ts): nothing is proposed.
export function readInterviewTurn(result: ModelResult): InterviewTurn | null {
  if (result.kind !== "ok") {
    return null;
  }
  const parsed = interviewTurnSchema.safeParse(parseJsonOrNull(result.outputText));
  if (!parsed.success) {
    return null;
  }
  const nextQuestion = cutToLength(toPlainSingleLine(parsed.data.next_question), INTERVIEW_QUESTION_MAX_LENGTH);
  if (!nextQuestion) {
    return null;
  }
  return {
    proposals: readProposedFacts(parsed.data.proposed_facts),
    nextQuestion,
    interviewComplete: parsed.data.interview_complete,
  };
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
