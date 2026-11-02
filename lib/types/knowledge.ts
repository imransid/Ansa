import type { KnowledgeArticleDetail } from "@/lib/types/knowledge-articles";

// One knowledge article's page, and the solved ticket "Save as knowledge"
// starts a new article from.

export type KnowledgeArticlePage = KnowledgeArticleDetail & {
  // How many pieces the search reads (core/internal/knowledge makes them).
  chunkCount: number;
};

// The solved ticket "Save as knowledge" came from, to fill in the form.
export type TicketForArticle = { ticketNumber: number; subject: string };
