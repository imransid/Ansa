import "server-only";
import { and, eq } from "drizzle-orm";
import type { ChatTarget } from "@/lib/chat-delivery";
import { db } from "./client";
import { recordActivityWithin, touchConversationWithin } from "./conversation-links";
import { discardDraftWithin } from "./conversation-writes";
import { lockActiveAuthorRole } from "./knowledge-author";
import { lockReplyRouteWithin, type ReplyRefusal } from "./reply-routes";
import { messages } from "./schema";

// The assistant's waiting replies ("Ask me first", step 49), sent or
// discarded by anyone in the company (as they work conversations): the
// person is read again, the conversation locked, the reply still waiting,
// all in one transaction. Sending it doesn't take the conversation over:
// the reply is still the assistant's, approved.

export type DraftOutcome = "not-allowed" | "not-waiting" | ReplyRefusal;

// Marks a waiting reply "sending" and returns where it goes and its text
// (encrypted), or why it can't go now (nothing changes then).
export async function claimDraftForSending(
  companyId: string,
  actorUserId: string,
  draft: { conversationId: string; messageId: string },
): Promise<{ target: ChatTarget; bodyEncrypted: string } | DraftOutcome> {
  return db.transaction(async (tx) => {
    if (!(await lockActiveAuthorRole(tx, companyId, actorUserId))) {
      return "not-allowed";
    }
    const route = await lockReplyRouteWithin(tx, companyId, draft.conversationId);
    if (typeof route === "string") {
      return route;
    }
    const [claimed] = await tx
      .update(messages)
      .set({ sendStatus: "sending" })
      .where(
        and(
          eq(messages.id, draft.messageId),
          eq(messages.companyId, companyId),
          eq(messages.conversationId, draft.conversationId),
          eq(messages.author, "assistant"),
          eq(messages.sendStatus, "draft"),
        ),
      )
      .returning({ bodyEncrypted: messages.bodyEncrypted });
    if (!claimed?.bodyEncrypted) {
      return "not-waiting";
    }
    await recordActivityWithin(tx, companyId, draft.conversationId, "draft_sent", actorUserId);
    await touchConversationWithin(tx, companyId, draft.conversationId, false);
    return { target: route.target, bodyEncrypted: claimed.bodyEncrypted };
  });
}

// Discards a waiting reply: never sent, kept as "discarded".
export async function discardDraft(companyId: string, actorUserId: string, draft: { conversationId: string; messageId: string }): Promise<"saved" | "not-allowed" | "not-waiting"> {
  return db.transaction(async (tx) => {
    if (!(await lockActiveAuthorRole(tx, companyId, actorUserId))) {
      return "not-allowed";
    }
    if (!(await discardDraftWithin(tx, companyId, draft.conversationId, draft.messageId))) {
      return "not-waiting";
    }
    await recordActivityWithin(tx, companyId, draft.conversationId, "draft_discarded", actorUserId);
    return "saved";
  });
}
