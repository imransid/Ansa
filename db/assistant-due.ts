import "server-only";
import { and, desc, eq, gt, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "./client";
import { conversations, messages } from "./schema";

// The conversations whose assistant waits to see whether you answer
// yourself first (step 51, "if I haven't answered within N minutes"). The
// scheduled runs claim the due ones of every company, one at a time, in ONE
// UPDATE each (a scalar SKIP LOCKED subquery, as the publishing queue's
// runner does): two runners never take the same one. That claim is one of
// the reads across companies (CLAUDE.md); everything after it works with
// the claimed row's own company.

// `onlyCompanyId`: the checks' own company only (they share the local
// database with the developer's data); the scheduled runs pass none.
export async function claimDueConversation(onlyCompanyId?: string): Promise<{ companyId: string; conversationId: string } | null> {
  const ofCompany = onlyCompanyId ? sql`AND ${conversations.companyId} = ${onlyCompanyId}` : sql``;
  const next = sql`(SELECT ${conversations.id} FROM ${conversations} WHERE ${conversations.assistantDueAt} <= now() ${ofCompany} ORDER BY ${conversations.assistantDueAt} LIMIT 1 FOR UPDATE SKIP LOCKED)`;
  const [claimed] = await db
    .update(conversations)
    .set({ assistantDueAt: null })
    .where(and(eq(conversations.id, next), lte(conversations.assistantDueAt, sql`now()`)))
    .returning({ companyId: conversations.companyId, conversationId: conversations.id });
  return claimed ?? null;
}

// The newest message the customer wrote in this conversation, and whether
// you (in ansa, or in your own Telegram app) answered after it.
export async function newestCustomerMessageAndAnswer(companyId: string, conversationId: string): Promise<{ messageId: string; answered: boolean } | null> {
  const [newest] = await db
    .select({ id: messages.id, createdAt: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.companyId, companyId), eq(messages.conversationId, conversationId), eq(messages.direction, "in"), isNotNull(messages.bodyEncrypted)))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  if (!newest) {
    return null;
  }
  const [answer] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.companyId, companyId),
        eq(messages.conversationId, conversationId),
        inArray(messages.author, ["person", "business_account"]),
        gt(messages.createdAt, newest.createdAt),
      ),
    )
    .limit(1);
  return { messageId: newest.id, answered: answer !== undefined };
}
