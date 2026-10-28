import { businessFactTopics, KEY_FACT_TOPICS, type BusinessFactTopic } from "@/lib/business-facts";

// Where a company's business profile stands (step 36): each topic's status,
// what is still missing, and how complete it is. Pure, so the interview, the
// pages and the checks all count the same way.

// What the profile holds for one topic: the confirmed value and the
// proposal waiting beside it (either can be null).
export type FactValues = { confirmedValue: string | null; proposedValue: string | null };
export type FactValuesByTopic = Partial<Record<BusinessFactTopic, FactValues>>;

// confirmed: the owner confirmed a value (a proposal may wait beside it).
// proposed: only a proposal, waiting for the owner. missing: neither.
export type FactStatus = "confirmed" | "proposed" | "missing";

export type ProfileCompletion = {
  keyConfirmed: number;
  keyTotal: number;
  // Topics with a proposal waiting for an owner to confirm or dismiss it.
  proposalsWaiting: number;
};

export function factStatus(values: FactValues | undefined): FactStatus {
  if (values?.confirmedValue) {
    return "confirmed";
  }
  return values?.proposedValue ? "proposed" : "missing";
}

// The first key topic, in the interview's order, with neither a confirmed
// value nor a proposal: what the interview asks about next without the AI.
// A proposal counts as answered: the owner only has to confirm it.
export function firstMissingKeyTopic(facts: FactValuesByTopic): BusinessFactTopic | null {
  return KEY_FACT_TOPICS.find((topic) => factStatus(facts[topic]) === "missing") ?? null;
}

// Counts the key facts an owner confirmed ("12 of 16"), and the proposals
// waiting. Only a confirmed value counts as known: a proposal is the AI's
// reading of what the owner said, not yet the owner's word.
export function measureProfileCompletion(facts: FactValuesByTopic): ProfileCompletion {
  const keyConfirmed = KEY_FACT_TOPICS.filter((topic) => factStatus(facts[topic]) === "confirmed").length;
  const proposalsWaiting = businessFactTopics.filter((topic) => Boolean(facts[topic]?.proposedValue)).length;
  return { keyConfirmed, keyTotal: KEY_FACT_TOPICS.length, proposalsWaiting };
}

// The profile as it will be once these proposals are saved: each topic
// proposed gets a proposal (its confirmed value stays). For deciding the
// interview's next step before the save.
export function withProposals(facts: FactValuesByTopic, proposals: { topic: BusinessFactTopic; value: string }[]): FactValuesByTopic {
  const next: FactValuesByTopic = { ...facts };
  for (const proposal of proposals) {
    next[proposal.topic] = { confirmedValue: facts[proposal.topic]?.confirmedValue ?? null, proposedValue: proposal.value };
  }
  return next;
}
