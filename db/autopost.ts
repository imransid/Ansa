import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import type { PostChoice, PostKind } from "@/lib/autopost/brain";
import type { AutopostFrequency, AutopostMode } from "@/lib/autopost/schedule";
import type { AutopostSlotStatus, SkipReason } from "@/lib/autopost/slots";
import { db } from "./client";
import { asRestaurantOwner, type SetupWriteOutcome } from "./restaurant-owner";
import { assistantSettings, autopostSlots, contentDrafts, postMetrics, publishJobs } from "./schema";

// "Post for me" (step 54): the switch, and one row per planned post. Every
// query matches the company, but one: the scheduled runs list which
// companies have it on (ids and settings only, one of the documented
// exceptions in CLAUDE.md), then work through each company's own rows.

export type AutopostChoices = { enabled: boolean; frequency: AutopostFrequency; time: string; mode: AutopostMode };

// Owners switch it (the company row lock, then their role read again).
// Switching it on records who and when: it posts in their name, and stops
// once they are no longer an owner. It needs the business's time zone.
export async function saveAutopostSettings(companyId: string, actorUserId: string, choices: AutopostChoices): Promise<SetupWriteOutcome | "no-time-zone"> {
  const [settings] = await db.select({ timeZone: assistantSettings.timeZone }).from(assistantSettings).where(eq(assistantSettings.companyId, companyId));
  if (choices.enabled && !settings?.timeZone) {
    return "no-time-zone";
  }
  return asRestaurantOwner(companyId, actorUserId, async (tx) => {
    const columns = {
      autopostEnabled: choices.enabled,
      autopostFrequency: choices.frequency,
      autopostTime: choices.time,
      autopostMode: choices.mode,
      autopostEnabledByUserId: choices.enabled ? actorUserId : null,
      autopostEnabledAt: choices.enabled ? sql`now()` : null,
      updatedByUserId: actorUserId,
    };
    // An UPDATE: switched on, the row exists (it holds the time zone), and
    // an INSERT's own row would break its "a time zone to post in" CHECK
    // before the conflict could turn it into an update.
    const updated = await tx
      .update(assistantSettings)
      .set({ ...columns, updatedAt: sql`now()` })
      .where(eq(assistantSettings.companyId, companyId))
      .returning({ companyId: assistantSettings.companyId });
    if (updated.length === 0 && !choices.enabled) {
      await tx.insert(assistantSettings).values({ companyId, ...columns });
    }
  });
}

export type AutopostCompany = AutopostChoices & { companyId: string; timeZone: string; enabledByUserId: string };

// The companies with "Post for me" on, across companies (the scheduled
// runs): their ids and these settings, nothing else of their rows.
export async function listCompaniesPostingForThem(): Promise<AutopostCompany[]> {
  const rows = await db
    .select({
      companyId: assistantSettings.companyId,
      frequency: assistantSettings.autopostFrequency,
      time: assistantSettings.autopostTime,
      mode: assistantSettings.autopostMode,
      timeZone: assistantSettings.timeZone,
      enabledByUserId: assistantSettings.autopostEnabledByUserId,
    })
    .from(assistantSettings)
    .where(eq(assistantSettings.autopostEnabled, true));
  return rows.flatMap((row) => (row.timeZone && row.enabledByUserId ? [{ ...row, enabled: true, timeZone: row.timeZone, enabledByUserId: row.enabledByUserId }] : []));
}

// Claims one posting moment for one company: its row, or null when another
// run has it already (the unique (company, post_at)).
export async function claimPostingTime(companyId: string, postAt: Date, choice: PostChoice): Promise<string | null> {
  const [row] = await db
    .insert(autopostSlots)
    .values({ companyId, postAt, kind: choice.kind, topic: choice.topic.slice(0, 200), itemName: choice.itemName.slice(0, 200), specialDay: choice.specialDay })
    .onConflictDoNothing({ target: [autopostSlots.companyId, autopostSlots.postAt] })
    .returning({ id: autopostSlots.id });
  return row?.id ?? null;
}

// What became of a claimed post: its draft and where it is, or why not.
export async function finishPostingTime(
  companyId: string,
  slotId: string,
  outcome: { status: Exclude<AutopostSlotStatus, "writing" | "skipped">; draftId: string; choice: PostChoice; attempts: number } | { status: "skipped"; reason: SkipReason; attempts: number },
): Promise<void> {
  const columns =
    outcome.status === "skipped"
      ? { status: outcome.status, skipReason: outcome.reason, attempts: outcome.attempts }
      : {
          status: outcome.status,
          draftId: outcome.draftId,
          kind: outcome.choice.kind,
          topic: outcome.choice.topic.slice(0, 200),
          itemName: outcome.choice.itemName.slice(0, 200),
          specialDay: outcome.choice.specialDay,
          attempts: outcome.attempts,
        };
  await db
    .update(autopostSlots)
    .set({ ...columns, updatedAt: sql`now()` })
    .where(and(eq(autopostSlots.id, slotId), eq(autopostSlots.companyId, companyId)));
}

export type PostedSlot = {
  id: string;
  postAt: Date;
  status: AutopostSlotStatus;
  kind: PostKind;
  topic: string;
  itemName: string;
  specialDay: string;
  skipReason: SkipReason | null;
  draftId: string | null;
  draftStatus: string | null;
  body: string | null;
  // Reactions + comments + shares in the post's newest numbers, or null.
  engagement: number | null;
};

// The company's newest planned posts, newest first, each with its draft's
// status and text and its newest numbers: the page, and ansa's brain
// (which learns from what people liked).
export async function listPostingTimes(companyId: string, limit: number): Promise<PostedSlot[]> {
  const newestEngagement = sql<number | null>`(
    SELECT coalesce(${postMetrics.reactions}, 0) + coalesce(${postMetrics.comments}, 0) + coalesce(${postMetrics.shares}, 0)
    FROM ${postMetrics}
    JOIN ${publishJobs} ON ${publishJobs.id} = ${postMetrics.publishJobId} AND ${publishJobs.companyId} = ${postMetrics.companyId}
    WHERE ${publishJobs.companyId} = ${autopostSlots.companyId} AND ${publishJobs.draftId} = ${autopostSlots.draftId}
    ORDER BY ${postMetrics.collectedAt} DESC
    LIMIT 1
  )`;
  return db
    .select({
      id: autopostSlots.id,
      postAt: autopostSlots.postAt,
      status: autopostSlots.status,
      kind: autopostSlots.kind,
      topic: autopostSlots.topic,
      itemName: autopostSlots.itemName,
      specialDay: autopostSlots.specialDay,
      skipReason: sql<SkipReason | null>`${autopostSlots.skipReason}`,
      draftId: autopostSlots.draftId,
      draftStatus: contentDrafts.status,
      body: contentDrafts.body,
      engagement: newestEngagement,
    })
    .from(autopostSlots)
    .leftJoin(contentDrafts, and(eq(contentDrafts.id, autopostSlots.draftId), eq(contentDrafts.companyId, autopostSlots.companyId)))
    .where(eq(autopostSlots.companyId, companyId))
    .orderBy(desc(autopostSlots.postAt))
    .limit(limit);
}

// Planned posts still on their way (switching it off takes them back; one
// that went out meanwhile can't be archived and stays as it is).
export async function upcomingPostingTimes(companyId: string): Promise<{ id: string; draftId: string | null }[]> {
  return db
    .select({ id: autopostSlots.id, draftId: autopostSlots.draftId })
    .from(autopostSlots)
    .where(and(eq(autopostSlots.companyId, companyId), sql`${autopostSlots.status} IN ('writing', 'scheduled', 'waiting_approval')`));
}

// Whether this posting time was claimed already (a cheap look before the
// writer reads everything it needs).
export async function postingTimeTaken(companyId: string, postAt: Date): Promise<boolean> {
  const [row] = await db
    .select({ id: autopostSlots.id })
    .from(autopostSlots)
    .where(and(eq(autopostSlots.companyId, companyId), eq(autopostSlots.postAt, postAt)));
  return row !== undefined;
}
