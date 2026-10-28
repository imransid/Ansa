import "server-only";
import { and, desc, eq } from "drizzle-orm";
import type { BusinessFactTopic } from "@/lib/business-facts";
import type { FactProposal } from "@/lib/cofounder/fact-proposals";
import { canManageBusinessProfile } from "@/lib/cofounder/permissions";
import { db } from "./client";
import { saveFactProposals } from "./business-fact-proposals";
import { lockCompanyRow } from "./company-lock";
import { lockActiveAuthorRole } from "./knowledge-author";
import { onboardingMessages, users, type InterviewMessageAuthor } from "./schema";

// One company's interview with the Co-Founder (step 36): its messages,
// encrypted by the caller (services/onboarding-interview.ts), and the
// proposals each reply brings. Only an active owner answers, starts over or
// gets a reply saved: the role is read again, locked, in each transaction.
//
// WHY every write here takes the company row lock FIRST (db/company-lock.ts,
// before the person's row): an answer, a reply and "Start over" then run one
// at a time per company. A lock on the answer's row alone would not do:
// Start over's DELETE would wait for it, but not see a reply saved
// meanwhile, and that reply would stay behind as a lone question. Nor would
// it see an answer saved meanwhile, which would stay without its question.

export type InterviewMessageRow = {
  id: string;
  author: InterviewMessageAuthor;
  // The owner who answered, read within the company; null for the Co-Founder.
  authorName: string | null;
  bodyEncrypted: string;
  endsInterview: boolean;
  createdAt: Date;
};

// A message to save: its id (made by the caller, the encryption context
// names it) and its encrypted text.
export type NewInterviewMessage = { id: string; bodyEncrypted: string };

export type SavedReplyOutcome =
  | { outcome: "saved"; proposedTopics: BusinessFactTopic[] }
  // The answer was deleted ("Start over") while Claude read it: nothing saved.
  | { outcome: "started-over" }
  | { outcome: "not-allowed" };

// The newest messages of one company's interview, newest first, at most `limit`.
export async function getNewestInterviewMessages(companyId: string, limit: number): Promise<InterviewMessageRow[]> {
  return db
    .select({
      id: onboardingMessages.id,
      author: onboardingMessages.author,
      authorName: users.name,
      bodyEncrypted: onboardingMessages.bodyEncrypted,
      endsInterview: onboardingMessages.endsInterview,
      createdAt: onboardingMessages.createdAt,
    })
    .from(onboardingMessages)
    .leftJoin(users, and(eq(users.id, onboardingMessages.authorUserId), eq(users.companyId, onboardingMessages.companyId)))
    .where(eq(onboardingMessages.companyId, companyId))
    .orderBy(desc(onboardingMessages.createdAt), desc(onboardingMessages.id))
    .limit(limit);
}

// Whether one company's interview has started (its first question is saved
// with the first answer), and whether the Co-Founder's newest message closed it.
export async function getInterviewState(companyId: string): Promise<{ started: boolean; finished: boolean }> {
  const [newestReply] = await db
    .select({ endsInterview: onboardingMessages.endsInterview })
    .from(onboardingMessages)
    .where(and(eq(onboardingMessages.companyId, companyId), eq(onboardingMessages.author, "assistant")))
    .orderBy(desc(onboardingMessages.createdAt), desc(onboardingMessages.id))
    .limit(1);
  return { started: newestReply !== undefined, finished: newestReply?.endsInterview ?? false };
}

// Saves an owner's answer to one company's interview. An interview's first
// answer also saves, before it, the opening question the page showed (fixed
// text, made by the caller), so the conversation reads in order. `opening` is
// null when the page showed a conversation under way: if that conversation
// is gone (someone started over meanwhile), the answer has no question left
// and nothing is saved ("started-over"). The company row lock also keeps two
// first answers at the same moment from both finding no message and both
// saving an opening question.
export async function saveInterviewAnswer(
  companyId: string,
  ownerUserId: string,
  messages: { opening: NewInterviewMessage | null; answer: NewInterviewMessage },
): Promise<"saved" | "started-over" | "not-allowed"> {
  return db.transaction(async (tx) => {
    await lockCompanyRow(tx, companyId);
    const role = await lockActiveAuthorRole(tx, companyId, ownerUserId);
    if (!role || !canManageBusinessProfile(role)) {
      return "not-allowed";
    }
    const [earlier] = await tx.select({ id: onboardingMessages.id }).from(onboardingMessages).where(eq(onboardingMessages.companyId, companyId)).limit(1);
    if (!earlier && !messages.opening) {
      return "started-over";
    }
    // Two statements, not one: each row's clock_timestamp() keeps them in order.
    if (!earlier && messages.opening) {
      const opening = messages.opening;
      await tx.insert(onboardingMessages).values({ id: opening.id, companyId, author: "assistant", bodyEncrypted: opening.bodyEncrypted });
    }
    const answer = messages.answer;
    await tx
      .insert(onboardingMessages)
      .values({ id: answer.id, companyId, author: "owner", authorUserId: ownerUserId, bodyEncrypted: answer.bodyEncrypted });
    return "saved";
  });
}

// Saves the Co-Founder's reply to an owner's answer, and the proposals it
// brings, in ONE transaction: both, or neither. Nothing is saved when the
// answer is gone (another owner, or another tab, started over while Claude
// read it), or when the person is no longer an active owner. Start over
// waits for this to finish (the company row lock), then deletes the reply
// with the rest.
export async function saveInterviewReply(
  companyId: string,
  ownerUserId: string,
  reply: { answerId: string; message: NewInterviewMessage; endsInterview: boolean; proposals: FactProposal[] },
): Promise<SavedReplyOutcome> {
  return db.transaction(async (tx) => {
    await lockCompanyRow(tx, companyId);
    const role = await lockActiveAuthorRole(tx, companyId, ownerUserId);
    if (!role || !canManageBusinessProfile(role)) {
      return { outcome: "not-allowed" };
    }
    const [answer] = await tx
      .select({ id: onboardingMessages.id })
      .from(onboardingMessages)
      .where(and(eq(onboardingMessages.companyId, companyId), eq(onboardingMessages.id, reply.answerId), eq(onboardingMessages.author, "owner")));
    if (!answer) {
      return { outcome: "started-over" };
    }
    const proposedTopics = await saveFactProposals(tx, companyId, reply.proposals, "interview");
    await tx.insert(onboardingMessages).values({
      id: reply.message.id,
      companyId,
      author: "assistant",
      bodyEncrypted: reply.message.bodyEncrypted,
      endsInterview: reply.endsInterview,
    });
    return { outcome: "saved", proposedTopics };
  });
}

// "Start over": deletes every message of one company's interview, never its
// facts. Owners only. An answer or a reply being saved finishes first (the
// company row lock), and is deleted with the rest.
export async function deleteInterviewMessages(companyId: string, actorUserId: string): Promise<"deleted" | "not-allowed"> {
  return db.transaction(async (tx) => {
    await lockCompanyRow(tx, companyId);
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    if (!role || !canManageBusinessProfile(role)) {
      return "not-allowed";
    }
    await tx.delete(onboardingMessages).where(eq(onboardingMessages.companyId, companyId));
    return "deleted";
  });
}
