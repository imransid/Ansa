import "server-only";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { HandoverReason } from "@/lib/assistant/reasons";
import type { ConversationChannel } from "@/lib/conversations";
import { db } from "./client";
import { lockActiveAuthorRole } from "./knowledge-author";
import { assistantActivity, awaySummaryReads, contacts, conversations } from "./schema";

// "While you were away" (step 51): what the assistant did since this person
// last pressed "Got it" on Home (or in the last day, before the first time),
// and that press. Every query matches the session's company and person.

export type AwaySummaryLine = {
  conversationId: string;
  contactName: string | null;
  channel: ConversationChannel;
  action: "replied" | "drafted" | "handed_over";
  reason: HandoverReason | null;
  createdAt: Date;
};

// The assistant's own lines since then, newest first (at most `limit`).
export async function listAwaySummary(companyId: string, userId: string, limit: number): Promise<{ since: Date; lines: AwaySummaryLine[] }> {
  const [read] = await db
    .select({ seenAt: awaySummaryReads.seenAt })
    .from(awaySummaryReads)
    .where(and(eq(awaySummaryReads.companyId, companyId), eq(awaySummaryReads.userId, userId)));
  const since = read?.seenAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      conversationId: assistantActivity.conversationId,
      contactName: contacts.displayName,
      channel: contacts.channel,
      action: sql<AwaySummaryLine["action"]>`${assistantActivity.action}`,
      reason: assistantActivity.reason,
      createdAt: assistantActivity.createdAt,
    })
    .from(assistantActivity)
    .innerJoin(conversations, and(eq(conversations.id, assistantActivity.conversationId), eq(conversations.companyId, assistantActivity.companyId)))
    .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.companyId, conversations.companyId)))
    .where(
      and(
        eq(assistantActivity.companyId, companyId),
        isNull(assistantActivity.actorUserId),
        inArray(assistantActivity.action, ["replied", "drafted", "handed_over"]),
        gt(assistantActivity.createdAt, since),
      ),
    )
    .orderBy(desc(assistantActivity.createdAt))
    .limit(limit);
  return { since, lines: rows };
}

// "Got it": the summary starts again from now for this person.
export async function markAwaySummarySeen(companyId: string, userId: string): Promise<"saved" | "not-allowed"> {
  return db.transaction(async (tx) => {
    if (!(await lockActiveAuthorRole(tx, companyId, userId))) {
      return "not-allowed";
    }
    await tx
      .insert(awaySummaryReads)
      .values({ companyId, userId, seenAt: sql`now()` })
      .onConflictDoUpdate({ target: [awaySummaryReads.companyId, awaySummaryReads.userId], set: { seenAt: sql`now()` } });
    return "saved";
  });
}
