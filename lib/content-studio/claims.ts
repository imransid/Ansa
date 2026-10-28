import { z } from "zod";
import { isBusinessFactTopic, labelOfTopic } from "@/lib/business-facts";

// The factual claims of a draft (step 38): what its text says about the
// business that someone could check (prices, features, numbers, results,
// dates, offers). The AI lists them; THIS CODE decides which a confirmed
// fact backs, never the AI: its answer has no "supported" field at all
// (draft-answer.ts). A claim is backed only when it names confirmed facts
// and every one of them was sent with the request. Shown or approved later,
// it is checked again: once one of its facts changed on the Profile page,
// it no longer counts as backed. Pure.

// A claim as content_drafts.claims stores it: `supported` as this code
// decided when the draft was written.
export type StoredClaim = { text: string; supported: boolean; fact_topics: string[] };

// A confirmed fact: as the request held it (content_drafts.facts_used), or
// as the profile holds it now.
export type FactValue = { topic: string; value: string };

// backed: a confirmed fact sent with the request states it, unchanged since.
// no_fact: the AI named no fact for it. fact_not_confirmed: it named one
// that wasn't confirmed (or wasn't sent). fact_changed: a fact it names
// has another value on the Profile page now.
export type ClaimStatus = "backed" | "no_fact" | "fact_not_confirmed" | "fact_changed";

export type CheckedClaim = {
  text: string;
  status: ClaimStatus;
  // The facts it names, with the value the draft was written from (null:
  // that fact wasn't among the confirmed facts sent).
  facts: { topic: string; label: string; value: string | null }[];
};

const storedClaimsSchema = z.array(z.object({ text: z.string(), supported: z.boolean(), fact_topics: z.array(z.string()) }));
const factsUsedSchema = z.array(z.object({ topic: z.string(), value: z.string() }));

// The claims the AI listed, as this code marks them. Each keeps the topics
// it names that are topics of the profile, sent or not, so the page can say
// which one wasn't confirmed; `supported` is decided on every name it gave.
export function markClaims(claims: { text: string; fact_topics: string[] }[], sentTopics: ReadonlySet<string>): StoredClaim[] {
  return claims.map((claim) => {
    const named = [...new Set(claim.fact_topics)];
    return {
      text: claim.text,
      supported: named.length > 0 && named.every((topic) => sentTopics.has(topic)),
      fact_topics: named.filter(isBusinessFactTopic),
    };
  });
}

// Each stored claim checked again against the facts the draft was written
// from and the confirmed facts now.
export function checkClaims(stored: StoredClaim[], factsUsed: FactValue[], currentFacts: FactValue[]): CheckedClaim[] {
  const sent = new Map(factsUsed.map((fact) => [fact.topic, fact.value]));
  const now = new Map(currentFacts.map((fact) => [fact.topic, fact.value]));
  return stored.map((claim) => ({
    text: claim.text,
    status: statusOf(claim, sent, now),
    facts: claim.fact_topics.map((topic) => ({ topic, label: labelOfTopic(topic), value: sent.get(topic) ?? null })),
  }));
}

// content_drafts.claims as stored, or null when it doesn't fit this shape
// (then nobody can say which claims are backed: the owner checks them).
export function readStoredClaims(stored: unknown): StoredClaim[] | null {
  const parsed = storedClaimsSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}

// content_drafts.facts_used as stored; anything else reads as no facts.
export function readFactsUsed(stored: unknown): FactValue[] {
  const parsed = factsUsedSchema.safeParse(stored);
  return parsed.success ? parsed.data : [];
}

function statusOf(claim: StoredClaim, sent: Map<string, string>, now: Map<string, string>): ClaimStatus {
  if (claim.fact_topics.length === 0) {
    return "no_fact";
  }
  if (!claim.supported || !claim.fact_topics.every((topic) => sent.has(topic))) {
    return "fact_not_confirmed";
  }
  return claim.fact_topics.every((topic) => now.get(topic) === sent.get(topic)) ? "backed" : "fact_changed";
}
