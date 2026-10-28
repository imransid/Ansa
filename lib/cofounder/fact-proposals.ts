import { z } from "zod";
import { businessFactTopics, isBusinessFactTopic, type BusinessFactTopic } from "@/lib/business-facts";
import { BUSINESS_FACT_MAX_LENGTH } from "./limits";

// The facts Claude proposes (step 36: the interview, and "Suggest facts from
// knowledge"). Proposals only: saving one never touches a confirmed value
// (db/business-fact-proposals.ts), and only an owner's Confirm makes it a fact.

export type FactProposal = { topic: BusinessFactTopic; value: string };

// The proposed_facts array as the API enforces it: the topic is one of ours.
// No length limits here: structured outputs don't support them, so
// readProposedFacts cuts instead.
export const PROPOSED_FACTS_JSON_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      topic: { type: "string", enum: [...businessFactTopics] },
      value: { type: "string" },
    },
    required: ["topic", "value"],
    additionalProperties: false,
  },
};

// One entry as we check it. Any topic text gets through here: an unknown
// one drops only its own entry (readProposedFacts), not the whole answer.
const proposedFactSchema = z.object({ topic: z.string(), value: z.string() }).strict();

// Turns Claude's proposed_facts into proposals that may be saved. An entry of
// another shape, of an unknown topic or with an empty value is dropped; the
// others still count. Values are cleaned (cleanFactValue). One proposal per
// topic: when Claude gives a topic twice, the later one (a correction).
export function readProposedFacts(entries: unknown[]): FactProposal[] {
  const valueByTopic = new Map<BusinessFactTopic, string>();
  for (const entry of entries) {
    const parsed = proposedFactSchema.safeParse(entry);
    if (!parsed.success || !isBusinessFactTopic(parsed.data.topic)) {
      continue;
    }
    const value = cleanFactValue(parsed.data.value);
    if (value) {
      valueByTopic.set(parsed.data.topic, value);
    }
  }
  return [...valueByTopic].map(([topic, value]) => ({ topic, value }));
}

// A value as a fact holds it: line breaks as \n, no control characters but
// line breaks and tabs (Postgres refuses NUL), at most one blank line in a
// row, no spaces at the ends, at most BUSINESS_FACT_MAX_LENGTH characters.
export function cleanFactValue(text: string): string {
  const tidy = text
    .replace(/\r\n?/g, "\n")
    .replace(/\p{Cc}/gu, (character) => (character === "\n" || character === "\t" ? character : ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cutToLength(tidy, BUSINESS_FACT_MAX_LENGTH);
}

// The start of text, at most maxLength UTF-16 units, never ending inside a
// character outside the Basic Multilingual Plane (an emoji is two units).
export function cutToLength(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  const lastUnit = text.charCodeAt(maxLength - 1);
  const endsInsidePair = lastUnit >= 0xd800 && lastUnit <= 0xdbff;
  return text.slice(0, endsInsidePair ? maxLength - 1 : maxLength).trimEnd();
}
