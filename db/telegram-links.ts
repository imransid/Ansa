import "server-only";
import { and, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { canManageRestaurant } from "@/lib/restaurant-permissions";
import { LINK_WAIT_MINUTES, type ChannelConnectionStatus } from "@/lib/telegram";
import { db } from "./client";
import { lockCompanyRow } from "./company-lock";
import { lockActiveAuthorRole } from "./knowledge-author";
import { channelConnections, telegramLinkCodes, telegramPendingConnections } from "./schema";

// What Telegram's webhook writes about connections (step 48). A webhook has
// no session, so these find the company from what only ansa issues or
// Telegram signs: a link code's hash (the company of the owner who made
// it), or a business connection a code already tied to a company. They
// read rows of whichever company that is, never more than they need, and
// run only after the webhook's secret was checked.

export type TelegramAccountFacts = {
  // Telegram's business connection id.
  externalId: string;
  accountTelegramId: string;
  accountChatId: string;
  displayName: string;
  canReply: boolean;
};

export type ClaimedLinkCode = { id: string; companyId: string; createdByUserId: string };

export type LinkOutcome = "connected" | "cannot-reply" | "elsewhere" | "company-has-another" | "not-allowed" | "used";

// Marks the code with this hash claimed by the Telegram user who pressed
// Start, if it is unclaimed and unexpired, in the one UPDATE that finds it
// (two Starts with one code: the second matches nothing). null: no such code.
export async function claimTelegramLinkCode(codeHash: string, telegramUserId: string): Promise<ClaimedLinkCode | null> {
  const [claimed] = await db
    .update(telegramLinkCodes)
    .set({ claimedByTelegramId: telegramUserId, claimedAt: sql`now()` })
    .where(and(eq(telegramLinkCodes.codeHash, codeHash), isNull(telegramLinkCodes.claimedAt), gt(telegramLinkCodes.expiresAt, sql`now()`)))
    .returning({ id: telegramLinkCodes.id, companyId: telegramLinkCodes.companyId, createdByUserId: telegramLinkCodes.createdByUserId });
  return claimed ?? null;
}

// The newest code this Telegram user claimed in the last hour that hasn't
// connected anything yet: the bot was added after the Start.
export async function findClaimedLinkCode(telegramUserId: string): Promise<ClaimedLinkCode | null> {
  const [code] = await db
    .select({ id: telegramLinkCodes.id, companyId: telegramLinkCodes.companyId, createdByUserId: telegramLinkCodes.createdByUserId })
    .from(telegramLinkCodes)
    .where(
      and(
        eq(telegramLinkCodes.claimedByTelegramId, telegramUserId),
        isNull(telegramLinkCodes.usedAt),
        gt(telegramLinkCodes.claimedAt, sql`now() - make_interval(mins => ${LINK_WAIT_MINUTES})`),
      ),
    )
    .orderBy(desc(telegramLinkCodes.claimedAt))
    .limit(1);
  return code ?? null;
}

// Keeps a business connection no code has named yet, for an hour: the bot
// was added before the Start. A newer one of the same id replaces it.
export async function savePendingConnection(facts: TelegramAccountFacts): Promise<void> {
  const values = {
    accountTelegramId: facts.accountTelegramId,
    accountChatId: facts.accountChatId,
    displayName: facts.displayName,
    canReply: facts.canReply,
    receivedAt: sql`now()`,
  };
  await db
    .insert(telegramPendingConnections)
    .values({ externalId: facts.externalId, ...values })
    .onConflictDoUpdate({ target: telegramPendingConnections.externalId, set: values });
}

// The newest business connection this Telegram user made in the last hour
// that no code has named yet, or null.
export async function findPendingConnection(telegramUserId: string): Promise<TelegramAccountFacts | null> {
  const [pending] = await db
    .select({
      externalId: telegramPendingConnections.externalId,
      accountTelegramId: telegramPendingConnections.accountTelegramId,
      accountChatId: telegramPendingConnections.accountChatId,
      displayName: telegramPendingConnections.displayName,
      canReply: telegramPendingConnections.canReply,
    })
    .from(telegramPendingConnections)
    .where(
      and(
        eq(telegramPendingConnections.accountTelegramId, telegramUserId),
        gt(telegramPendingConnections.receivedAt, sql`now() - make_interval(mins => ${LINK_WAIT_MINUTES})`),
      ),
    )
    .orderBy(desc(telegramPendingConnections.receivedAt))
    .limit(1);
  return pending ?? null;
}

// The bot was removed before any code named it: nothing waits any more.
export async function deletePendingConnection(externalId: string): Promise<void> {
  await db.delete(telegramPendingConnections).where(eq(telegramPendingConnections.externalId, externalId));
}

// Ties a Telegram account to the company of the code its owner claimed, in
// one transaction: the company row lock first, then the code's maker read
// again (still an active owner), then the code (still unused, locked).
// Refused when the account is tied to another company ("elsewhere"), or
// the company has another one ("company-has-another"; one removed in
// Telegram is disconnected and replaced).
export async function linkTelegramAccount(code: ClaimedLinkCode, facts: TelegramAccountFacts): Promise<LinkOutcome> {
  return db.transaction(async (tx) => {
    await lockCompanyRow(tx, code.companyId);
    const role = await lockActiveAuthorRole(tx, code.companyId, code.createdByUserId);
    if (!role || !canManageRestaurant(role)) {
      return "not-allowed";
    }
    const [open] = await tx
      .select({ id: telegramLinkCodes.id })
      .from(telegramLinkCodes)
      .where(and(eq(telegramLinkCodes.id, code.id), eq(telegramLinkCodes.companyId, code.companyId), isNull(telegramLinkCodes.usedAt)))
      .for("update");
    if (!open) {
      return "used";
    }
    // Which company the account is tied to now, if any: only that company's id is read.
    const [tied] = await tx
      .select({ id: channelConnections.id, companyId: channelConnections.companyId })
      .from(channelConnections)
      .where(and(eq(channelConnections.channel, "telegram"), eq(channelConnections.externalId, facts.externalId), ne(channelConnections.status, "disconnected")));
    if (tied && tied.companyId !== code.companyId) {
      return "elsewhere";
    }
    const status: ChannelConnectionStatus = facts.canReply ? "connected" : "cannot_reply";
    const accountValues = {
      accountTelegramId: facts.accountTelegramId,
      accountChatId: facts.accountChatId,
      displayName: facts.displayName,
      status,
      connectedByUserId: code.createdByUserId,
      connectedAt: sql`now()`,
      updatedAt: sql`now()`,
    };
    if (tied) {
      await tx
        .update(channelConnections)
        .set(accountValues)
        .where(and(eq(channelConnections.id, tied.id), eq(channelConnections.companyId, code.companyId)));
    } else {
      const [other] = await tx
        .select({ id: channelConnections.id, status: channelConnections.status })
        .from(channelConnections)
        .where(and(eq(channelConnections.companyId, code.companyId), eq(channelConnections.channel, "telegram"), ne(channelConnections.status, "disconnected")));
      if (other && other.status !== "removed_in_telegram") {
        return "company-has-another";
      }
      if (other) {
        await tx
          .update(channelConnections)
          .set({ status: "disconnected", disconnectedAt: sql`now()`, updatedAt: sql`now()` })
          .where(and(eq(channelConnections.id, other.id), eq(channelConnections.companyId, code.companyId)));
      }
      await tx.insert(channelConnections).values({ companyId: code.companyId, channel: "telegram", externalId: facts.externalId, ...accountValues });
    }
    await tx
      .update(telegramLinkCodes)
      .set({ usedAt: sql`now()` })
      .where(and(eq(telegramLinkCodes.id, code.id), eq(telegramLinkCodes.companyId, code.companyId)));
    await tx.delete(telegramPendingConnections).where(eq(telegramPendingConnections.externalId, facts.externalId));
    return status === "connected" ? "connected" : "cannot-reply";
  });
}

// Telegram says an account tied to a company changed: the bot removed or
// added back, its permission to reply, its name. Returns the new status, or
// null when no company has that account (a code may name it then).
export async function updateLinkedTelegramAccount(
  facts: TelegramAccountFacts & { isEnabled: boolean },
): Promise<ChannelConnectionStatus | null> {
  const status: ChannelConnectionStatus = !facts.isEnabled ? "removed_in_telegram" : facts.canReply ? "connected" : "cannot_reply";
  const [changed] = await db
    .update(channelConnections)
    .set({ status, displayName: facts.displayName, accountChatId: facts.accountChatId, updatedAt: sql`now()` })
    .where(and(eq(channelConnections.channel, "telegram"), eq(channelConnections.externalId, facts.externalId), ne(channelConnections.status, "disconnected")))
    .returning({ status: channelConnections.status });
  return changed?.status ?? null;
}

// The company a customer's message belongs to: the one whose Telegram
// account the message came through, while ansa may read it. null: no
// company has it (never tied, disconnected, or removed in Telegram).
export async function findTelegramConnectionForMessages(externalId: string): Promise<{ companyId: string; accountTelegramId: string } | null> {
  const [connection] = await db
    .select({ companyId: channelConnections.companyId, accountTelegramId: channelConnections.accountTelegramId })
    .from(channelConnections)
    .where(
      and(
        eq(channelConnections.channel, "telegram"),
        eq(channelConnections.externalId, externalId),
        inArray(channelConnections.status, ["connected", "cannot_reply"]),
      ),
    );
  return connection ?? null;
}
