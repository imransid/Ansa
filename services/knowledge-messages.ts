import "server-only";
import type { ArticleChangeOutcome } from "@/db/knowledge-writes";
import type { FormResult } from "@/lib/form-result";

// What the Knowledge pages say after a change to an article (step 34), in one
// place so every way to refuse one reads the same.

export type KnowledgeAction = "edit" | "approve" | "archive" | "restore" | "delete";

const NOT_ALLOWED: Record<KnowledgeAction, string> = {
  edit: "You can't change this article: only owners change approved articles, and an archived one must be restored first.",
  approve: "Only owners can approve articles.",
  archive: "Only owners can archive articles.",
  restore: "Only owners can restore articles.",
  delete: "Only owners can delete articles.",
};

// The person may make the change, but the article's status no longer fits it:
// another owner changed it after this page was opened.
const WRONG_STATUS: Record<KnowledgeAction, string> = {
  edit: "This article changed meanwhile. Reload the page and try again.",
  approve: "This article was archived meanwhile. Reload the page: restore it as a draft first, then approve it.",
  archive: "This article changed meanwhile. Reload the page and try again.",
  restore: "This article is no longer archived: someone restored it meanwhile. Reload the page to see it.",
  delete: "This article changed meanwhile. Reload the page and try again.",
};

const STALE: Record<KnowledgeAction, string> = {
  edit: "Someone changed this article after you opened it, so your change was not saved. Copy your text, reload the page and make your change again.",
  approve: "Someone changed this draft after you opened it, so it was not approved. Read it again, then approve it.",
  archive: "This article changed meanwhile. Reload the page and try again.",
  restore: "This article changed meanwhile. Reload the page and try again.",
  delete: "This article changed meanwhile. Reload the page and try again.",
};

// Turns what /db did with a change into what its form shows. "unchanged"
// counts as done: the article already is what was asked.
export function describeKnowledgeOutcome(outcome: ArticleChangeOutcome | "deleted", action: KnowledgeAction): FormResult {
  switch (outcome) {
    case "changed":
    case "unchanged":
    case "deleted":
      return { ok: true };
    case "not-found":
      return { ok: false, errors: { message: "That article was not found in your company." } };
    case "not-allowed":
      return { ok: false, errors: { message: NOT_ALLOWED[action] } };
    case "stale":
      return { ok: false, errors: { message: STALE[action] } };
    case "wrong-status":
      return { ok: false, errors: { message: WRONG_STATUS[action] } };
  }
}
