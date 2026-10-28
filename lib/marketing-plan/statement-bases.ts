// How each main point of a marketing plan is labeled (step 37), with the
// words the pages use. A file of its own with no imports, so the plan's
// schema and the pages read one list.

export const statementBases = ["fact", "assumption", "suggestion"] as const;
export type StatementBasis = (typeof statementBases)[number];

export const STATEMENT_BASIS_LABELS: Record<StatementBasis, string> = {
  fact: "Fact",
  assumption: "Assumption",
  suggestion: "Suggestion",
};

// The legend beside the plan's main points. WHY "says": the code checks only
// that a Fact names confirmed facts that were sent (fact-basis.ts), not
// that it says what they say.
export const STATEMENT_BASIS_MEANINGS: Record<StatementBasis, string> = {
  fact: "The AI says this repeats facts confirmed on the Profile page, named under it. Check that it says what they say.",
  assumption: "What the AI believes about your business, customers or market without a confirmed fact saying it. Check it before relying on it.",
  suggestion: "What the AI recommends doing.",
};
