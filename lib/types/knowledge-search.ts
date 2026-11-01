import type { FormErrors } from "@/lib/form-result";
import type { KnowledgeKind } from "@/lib/knowledge/kinds";
import type { KnowledgeSlice } from "@/lib/knowledge/prompt-slice";

// Searching the company's approved knowledge (step 34): what the AI would get
// for a customer's question, and the articles related to a ticket.

// One approved support article that matches a ticket, with its best piece.
export type RelatedArticle = {
  articleId: string;
  title: string;
  kind: KnowledgeKind;
  text: string;
};

// "Test what the AI finds": the hits exactly as the AI would get them, and
// the one line the phone assistant would get during a call (step 35), or
// why not.
export type KnowledgeTestResult = { ok: true; slice: KnowledgeSlice; callAnswer: string } | { ok: false; errors: FormErrors };
