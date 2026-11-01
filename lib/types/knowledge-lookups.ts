// What the voice assistant looked up in the company's knowledge during a
// call (step 35), as the call page shows it.

export type CallKnowledgeLookup = {
  id: string;
  at: Date;
  // The articles the answer held, best first; none = nothing was found.
  // A null title: the article was deleted since.
  articles: { articleId: string; title: string | null }[];
};

export type CallKnowledgeLookups = {
  // Oldest first, at most MAX_CALL_LOOKUPS_SHOWN.
  lookups: CallKnowledgeLookup[];
  moreNotShown: boolean;
};
