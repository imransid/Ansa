import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { KnowledgeStatus } from "@/lib/knowledge/kinds";
import { canManageKnowledge } from "@/lib/knowledge/permissions";
import { db } from "./client";
import { lockActiveAuthorRole } from "./knowledge-author";
import type { ArticleChangeOutcome } from "./knowledge-writes";
import { knowledgeArticles } from "./schema";

// What only owners do with one company's knowledge articles (step 34):
// approve a draft (then the AI may use it), archive (nobody uses it),
// restore an archived one as a draft, and delete. The owner's role is read
// again, locked, in the same transaction (db/knowledge-author.ts says why).

export type KnowledgeStatusChange = "approve" | "archive" | "restore";

// The statuses each change starts from, and where it leads.
const CHANGES: Record<KnowledgeStatusChange, { from: KnowledgeStatus[]; to: KnowledgeStatus }> = {
  approve: { from: ["draft"], to: "approved" },
  archive: { from: ["draft", "approved"], to: "archived" },
  restore: { from: ["archived"], to: "draft" },
};

// Changes the status of one article of one company. Approving names the
// revision the owner read: if someone changed the draft since, nothing is
// approved ("stale"), so an owner never approves words they didn't see. An
// article already where the change leads is "unchanged"; one whose status
// the change can't start from (approving an archived one, restoring one
// another owner restored and approved meanwhile) is "wrong-status".
export async function changeKnowledgeArticleStatus(
  companyId: string,
  actorUserId: string,
  change: { articleId: string; to: KnowledgeStatusChange; revision: number | null },
): Promise<ArticleChangeOutcome> {
  return db.transaction(async (tx) => {
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    const [current] = await tx
      .select({ status: knowledgeArticles.status, revision: knowledgeArticles.revision })
      .from(knowledgeArticles)
      .where(and(eq(knowledgeArticles.companyId, companyId), eq(knowledgeArticles.id, change.articleId)))
      .for("update");
    if (!current) {
      return "not-found";
    }
    if (!role || !canManageKnowledge(role)) {
      return "not-allowed";
    }
    const rule = CHANGES[change.to];
    if (current.status === rule.to) {
      return "unchanged";
    }
    if (!rule.from.includes(current.status)) {
      return "wrong-status";
    }
    if (change.to === "approve" && current.revision !== change.revision) {
      return "stale";
    }
    await tx
      .update(knowledgeArticles)
      .set({ status: rule.to, ...approvalColumns(change.to, actorUserId), updatedByUserId: actorUserId, updatedAt: sql`now()` })
      .where(and(eq(knowledgeArticles.companyId, companyId), eq(knowledgeArticles.id, change.articleId)));
    return "changed";
  });
}

// Deletes one article of one company and, through ON DELETE CASCADE, its
// pieces. For good: there is no undo (archive keeps it instead).
export async function deleteKnowledgeArticle(
  companyId: string,
  actorUserId: string,
  articleId: string,
): Promise<"deleted" | "not-found" | "not-allowed"> {
  return db.transaction(async (tx) => {
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    if (!role || !canManageKnowledge(role)) {
      return "not-allowed";
    }
    const deleted = await tx
      .delete(knowledgeArticles)
      .where(and(eq(knowledgeArticles.companyId, companyId), eq(knowledgeArticles.id, articleId)))
      .returning({ id: knowledgeArticles.id });
    return deleted.length > 0 ? "deleted" : "not-found";
  });
}

// Approving records who and when. Back to draft clears it (a draft carries
// no approval, a CHECK says so). Archiving keeps it: who last approved it.
function approvalColumns(to: KnowledgeStatusChange, actorUserId: string) {
  if (to === "approve") {
    return { approvedByUserId: actorUserId, approvedAt: sql`now()` };
  }
  if (to === "restore") {
    return { approvedByUserId: null, approvedAt: null };
  }
  return {};
}
