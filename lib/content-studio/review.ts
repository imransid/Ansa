import { checkContentRules, type AttachedMedia, type ContentIssue, type DraftContent } from "@/lib/content-rules";
import { checkClaims, readFactsUsed, readStoredClaims, type CheckedClaim, type FactValue } from "./claims";
import { readWordsToAvoid } from "./words-to-avoid";

// What an owner must know before approving one draft (step 38): the
// platform's rules, the claims, and whether "I checked these claims" must
// be ticked. ONE function, so the draft's page and the approval in /db
// (inside the transaction that writes) decide the same way. Pure.

// current: the AI listed the claims for the text as it is now (an image or
// video attached since changes no text). edited: the AI listed them, but
// someone changed the text since. written_by_hand: the AI never wrote this
// draft, so nobody listed its claims.
export type ClaimsState = "current" | "edited" | "written_by_hand";

export type DraftForReview = DraftContent & {
  version: number;
  generatedVersion: number | null;
  // As stored (content_drafts.claims and facts_used).
  claims: unknown;
  factsUsed: unknown;
  // The image or video attached (step 39), with its alt text; null: none.
  media: AttachedMedia | null;
};

export type DraftReview = {
  issues: ContentIssue[];
  // The issues that stop approval.
  blockingIssues: ContentIssue[];
  claims: CheckedClaim[];
  claimsState: ClaimsState;
  // The owner must tick "I checked these claims" to approve: a claim isn't
  // backed by a confirmed fact, or nobody listed the claims of this text.
  acknowledgmentNeeded: boolean;
  // What the rules looked for (from the confirmed "Words to avoid" fact).
  wordsToAvoid: string[];
};

// Reviews a draft against the company's confirmed facts as they are now.
// WHY "edited" and "written_by_hand" need the tick too: the AI's list
// describes the text it wrote, and a claim someone typed in is a claim no
// code has checked.
export function reviewDraft(draft: DraftForReview, currentFacts: FactValue[]): DraftReview {
  const wordsToAvoid = readWordsToAvoid(currentFacts.find((fact) => fact.topic === "words_to_avoid")?.value ?? null);
  const issues = checkContentRules(draft, { media: draft.media, wordsToAvoid });
  const stored = readStoredClaims(draft.claims);
  const claims = stored ? checkClaims(stored, readFactsUsed(draft.factsUsed), currentFacts) : [];
  const claimsState = stateOfClaims(draft);
  return {
    issues,
    blockingIssues: issues.filter((issue) => issue.severity === "blocking"),
    claims,
    claimsState,
    acknowledgmentNeeded: claimsState !== "current" || stored === null || claims.some((claim) => claim.status !== "backed"),
    wordsToAvoid,
  };
}

function stateOfClaims(draft: Pick<DraftForReview, "version" | "generatedVersion">): ClaimsState {
  if (draft.generatedVersion === null) {
    return "written_by_hand";
  }
  return draft.generatedVersion === draft.version ? "current" : "edited";
}
