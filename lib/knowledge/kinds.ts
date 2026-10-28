// The kinds and statuses of a knowledge article (step 34), with the words
// the pages use for them. A file of its own with no imports, so the forms in
// the browser and the database schema (db/schema/knowledge.ts, whose CHECKs
// list the same values) read one list.

export const knowledgeKinds = ["faq", "policy", "product", "guide", "solution", "document", "website"] as const;
export type KnowledgeKind = (typeof knowledgeKinds)[number];

// draft: written or imported, never used by any AI. approved: an owner read
// it and the AI may use it (for the audiences ticked). archived: kept, used
// by nobody, until an owner restores it as a draft.
export const knowledgeStatuses = ["draft", "approved", "archived"] as const;
export type KnowledgeStatus = (typeof knowledgeStatuses)[number];

export const KNOWLEDGE_KIND_LABELS: Record<KnowledgeKind, string> = {
  faq: "FAQ",
  policy: "Policy",
  product: "Product",
  guide: "How-to guide",
  solution: "Solution to a problem",
  document: "From a document",
  website: "From a web page",
};

export const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  archived: "Archived",
};

// Who an article may be used for. A required choice wherever the AI reads
// knowledge: support (calls, emails, the ticket page) or marketing (the
// Co-Founder, later steps). Drafts and archived articles are never used.
export const knowledgeAudiences = ["support", "marketing"] as const;
export type KnowledgeAudience = (typeof knowledgeAudiences)[number];
