import "server-only";
import { changeKnowledgeArticleStatus, deleteKnowledgeArticle, type KnowledgeStatusChange } from "@/db/knowledge-status";
import type { FormResult } from "@/lib/form-result";
import { canManageKnowledge } from "@/lib/knowledge/permissions";
import type { SessionContext } from "@/lib/session";
import { approveKnowledgeArticleSchema, knowledgeArticleIdSchema } from "@/lib/validation/knowledge";
import { tooManyChanges } from "./knowledge";
import { describeKnowledgeOutcome, type KnowledgeAction } from "./knowledge-messages";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// What only owners do with the company's knowledge articles (step 34). The
// role is checked here for a clear message, and again in /db, locked, in the
// transaction that writes.

// Approves a draft of the session's company, as the revision the owner read,
// so the AI may use it for the audiences ticked. Owners only.
export async function approveKnowledgeArticleForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = approveKnowledgeArticleSchema.safeParse(input);
  if (!parsed.success) {
    return unknownArticle();
  }
  return changeStatus(session, { articleId: parsed.data.articleId, to: "approve", revision: parsed.data.revision });
}

// Archives one of the session company's articles: kept, used by nobody. Owners only.
export async function archiveKnowledgeArticleForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = knowledgeArticleIdSchema.safeParse(input);
  if (!parsed.success) {
    return unknownArticle();
  }
  return changeStatus(session, { articleId: parsed.data.articleId, to: "archive", revision: null });
}

// Restores an archived article of the session's company as a draft, to be
// approved again before the AI uses it. Owners only.
export async function restoreKnowledgeArticleForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = knowledgeArticleIdSchema.safeParse(input);
  if (!parsed.success) {
    return unknownArticle();
  }
  return changeStatus(session, { articleId: parsed.data.articleId, to: "restore", revision: null });
}

// Deletes one of the session company's articles and its pieces, for good. Owners only.
export async function deleteKnowledgeArticleForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  if (!canManageKnowledge(session.role)) {
    return describeKnowledgeOutcome("not-allowed", "delete");
  }
  const parsed = knowledgeArticleIdSchema.safeParse(input);
  if (!parsed.success) {
    return unknownArticle();
  }
  if (await isOverRateLimit("knowledge-writes", session.userId, RATE_LIMITS.knowledgeWritesPerUser)) {
    return tooManyChanges();
  }
  return describeKnowledgeOutcome(await deleteKnowledgeArticle(session.companyId, session.userId, parsed.data.articleId), "delete");
}

const ACTIONS: Record<KnowledgeStatusChange, KnowledgeAction> = { approve: "approve", archive: "archive", restore: "restore" };

async function changeStatus(
  session: SessionContext,
  change: { articleId: string; to: KnowledgeStatusChange; revision: number | null },
): Promise<FormResult> {
  const action = ACTIONS[change.to];
  if (!canManageKnowledge(session.role)) {
    return describeKnowledgeOutcome("not-allowed", action);
  }
  if (await isOverRateLimit("knowledge-writes", session.userId, RATE_LIMITS.knowledgeWritesPerUser)) {
    return tooManyChanges();
  }
  return describeKnowledgeOutcome(await changeKnowledgeArticleStatus(session.companyId, session.userId, change), action);
}

function unknownArticle(): FormResult {
  return { ok: false, errors: { message: "Unknown article." } };
}
