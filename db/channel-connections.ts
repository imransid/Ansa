import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { LINK_CODE_LIFETIME_MINUTES } from "@/lib/telegram";
import { db, type DbTransaction } from "./client";
import { asRestaurantOwner, type SetupWriteOutcome } from "./restaurant-owner";
import { channelConnections, telegramLinkCodes } from "./schema";

// One company's Telegram connection (step 48), as Settings → Channels shows
// and changes it: only owners connect and disconnect (asRestaurantOwner:
// the company row lock, then the person's role read again). Every query
// matches the session's company. What Telegram's webhook writes is in
// db/telegram-links.ts.

export type TelegramConnectionView = {
  id: string;
  displayName: string;
  status: "connected" | "cannot_reply" | "removed_in_telegram";
  isStandIn: boolean;
  connectedAt: Date;
};

// The company's Telegram account while it is tied to the company, or null.
export async function getLiveTelegramConnection(companyId: string): Promise<TelegramConnectionView | null> {
  const [row] = await db
    .select({
      id: channelConnections.id,
      displayName: channelConnections.displayName,
      status: channelConnections.status,
      isStandIn: channelConnections.isStandIn,
      connectedAt: channelConnections.connectedAt,
    })
    .from(channelConnections)
    .where(liveTelegramOf(companyId))
    .orderBy(desc(channelConnections.connectedAt))
    .limit(1);
  if (!row || row.status === "disconnected") {
    return null;
  }
  return { ...row, status: row.status };
}

// Where a reply to a Telegram customer goes, read inside the reply's
// transaction: the connection's Telegram id and whether ansa may send.
export async function telegramReplyRouteWithin(tx: DbTransaction, companyId: string) {
  const [row] = await tx
    .select({ externalId: channelConnections.externalId, status: channelConnections.status, isStandIn: channelConnections.isStandIn })
    .from(channelConnections)
    .where(liveTelegramOf(companyId))
    .limit(1);
  return row ?? null;
}

// The bot's private chat with the restaurant's own Telegram account, where
// owner alerts go (step 49), while a real account is tied to the company.
export async function telegramAlertChat(companyId: string): Promise<string | null> {
  const [row] = await db
    .select({ accountChatId: channelConnections.accountChatId })
    .from(channelConnections)
    .where(and(liveTelegramOf(companyId), eq(channelConnections.isStandIn, false), ne(channelConnections.status, "removed_in_telegram")))
    .limit(1);
  return row?.accountChatId ?? null;
}

// Saves a one-time link code (its hash) for 10 minutes, while the person is
// an active owner.
export async function createTelegramLinkCode(companyId: string, actorUserId: string, codeHash: string): Promise<SetupWriteOutcome> {
  return asRestaurantOwner(companyId, actorUserId, async (tx) => {
    await tx.insert(telegramLinkCodes).values({
      companyId,
      createdByUserId: actorUserId,
      codeHash,
      expiresAt: sql`now() + make_interval(mins => ${LINK_CODE_LIFETIME_MINUTES})`,
    });
  });
}

// Disconnects the company's Telegram account in ansa: its messages stop
// arriving, and replies stop. The row stays, as history. "none": nothing
// was connected.
export async function disconnectTelegram(companyId: string, actorUserId: string): Promise<SetupWriteOutcome | "none"> {
  let found = false;
  const outcome = await asRestaurantOwner(companyId, actorUserId, async (tx) => {
    const changed = await tx
      .update(channelConnections)
      .set({ status: "disconnected", disconnectedAt: sql`now()`, updatedAt: sql`now()` })
      .where(liveTelegramOf(companyId))
      .returning({ id: channelConnections.id });
    found = changed.length > 0;
  });
  return outcome === "saved" && !found ? "none" : outcome;
}

// Development only (the service checks): connects a stand-in Telegram
// account, whose customers' messages `pnpm simulate:telegram` brings in.
// "exists": the company already has a Telegram account.
export async function connectStandInTelegram(companyId: string, actorUserId: string): Promise<SetupWriteOutcome | "exists"> {
  let exists = false;
  const outcome = await asRestaurantOwner(companyId, actorUserId, async (tx) => {
    const [live] = await tx.select({ id: channelConnections.id }).from(channelConnections).where(liveTelegramOf(companyId)).limit(1);
    if (live) {
      exists = true;
      return;
    }
    await tx.insert(channelConnections).values({
      companyId,
      channel: "telegram",
      externalId: `stand-in:${randomUUID()}`,
      accountTelegramId: "1",
      accountChatId: "1",
      displayName: "Stand-in Telegram account",
      status: "connected",
      isStandIn: true,
      connectedByUserId: actorUserId,
    });
  });
  return outcome === "saved" && exists ? "exists" : outcome;
}

// The Telegram id of the company's stand-in account, for pnpm simulate:telegram.
export async function findStandInTelegramConnection(companyId: string): Promise<string | null> {
  const [row] = await db
    .select({ externalId: channelConnections.externalId })
    .from(channelConnections)
    .where(and(liveTelegramOf(companyId), eq(channelConnections.isStandIn, true)))
    .limit(1);
  return row?.externalId ?? null;
}

function liveTelegramOf(companyId: string) {
  return and(
    eq(channelConnections.companyId, companyId),
    eq(channelConnections.channel, "telegram"),
    ne(channelConnections.status, "disconnected"),
  );
}
