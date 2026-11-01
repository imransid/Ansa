import type { BusinessFactTopic } from "@/lib/business-facts";
import type { FormErrors } from "@/lib/form-result";

// "Suggest facts from knowledge" (step 36): an owner picks one of the
// company's approved knowledge articles meant for support or marketing, and
// Claude proposes the facts it states. Proposals only, saved beside the
// confirmed values for an owner to confirm or dismiss on the Profile page.

export type FactSuggestionResult =
  | {
      ok: true;
      // The topics that got a new proposal (none: the article said nothing new).
      proposedTopics: { topic: BusinessFactTopic; label: string }[];
      // false: the article is longer than the AI reads, so only its first part was read.
      readWholeArticle: boolean;
    }
  | { ok: false; errors: FormErrors };
