import "server-only";
import { eq, sql } from "drizzle-orm";
import type { AnswerWhen } from "@/lib/assistant/availability";
import type { OpeningHours } from "@/lib/opening-hours";
import type { AssistantStatus, ReplyMode } from "@/lib/restaurant-setup";
import { db } from "./client";
import { asRestaurantOwner, recordSetupProgressWithin, type SetupWriteOutcome } from "./restaurant-owner";
import { assistantSettings } from "./schema";

// One restaurant's assistant settings (step 45): one row per company, made by
// the first setup step or Settings form that saves into it (until then the
// columns' defaults hold). Every write is an owner's, checked again inside
// its transaction (db/restaurant-owner.ts), and names its columns: an object
// carrying a companyId or anything else can't write it. `reached`: the setup
// step this save completes (null when it comes from Settings).

export type AssistantSettingsRow = typeof assistantSettings.$inferSelect;

// The company's settings row, or null before anything was saved.
export async function getAssistantSettings(companyId: string): Promise<AssistantSettingsRow | null> {
  const [row] = await db.select().from(assistantSettings).where(eq(assistantSettings.companyId, companyId));
  return row ?? null;
}

// Step 3: opening hours, in the restaurant's time zone.
export async function saveHoursSection(
  companyId: string,
  actorUserId: string,
  section: { timeZone: string; openingHours: OpeningHours },
  reached: number | null,
): Promise<SetupWriteOutcome> {
  return asRestaurantOwner(companyId, actorUserId, async (tx) => {
    await tx
      .insert(assistantSettings)
      .values({ companyId, timeZone: section.timeZone, openingHours: section.openingHours, updatedByUserId: actorUserId })
      .onConflictDoUpdate({
        target: assistantSettings.companyId,
        set: { timeZone: section.timeZone, openingHours: section.openingHours, updatedByUserId: actorUserId, updatedAt: sql`now()` },
      });
    await recordSetupProgressWithin(tx, companyId, reached);
  });
}

// A person's setup step 2, and Settings → Assistant (step 51): the weekly
// hours ansa answers for you, their time zone, and how long ansa waits for
// you to answer yourself (null: it doesn't step in while you're available).
export type AwaySection = { timeZone: string; awayHours: OpeningHours; replyGraceMinutes: number | null };

export async function saveAwaySection(companyId: string, actorUserId: string, section: AwaySection, reached: number | null): Promise<SetupWriteOutcome> {
  return asRestaurantOwner(companyId, actorUserId, async (tx) => {
    const columns = { timeZone: section.timeZone, awayHours: section.awayHours, replyGraceMinutes: section.replyGraceMinutes, updatedByUserId: actorUserId };
    await tx
      .insert(assistantSettings)
      .values({ companyId, ...columns })
      .onConflictDoUpdate({ target: assistantSettings.companyId, set: { ...columns, updatedAt: sql`now()` } });
    await recordSetupProgressWithin(tx, companyId, reached);
  });
}

// "Always" or "Only when I'm away" (Settings → Assistant, step 51).
export async function saveAnswerWhen(companyId: string, actorUserId: string, answerWhen: AnswerWhen): Promise<SetupWriteOutcome> {
  return asRestaurantOwner(companyId, actorUserId, async (tx) => {
    await tx
      .insert(assistantSettings)
      .values({ companyId, answerWhen, updatedByUserId: actorUserId })
      .onConflictDoUpdate({ target: assistantSettings.companyId, set: { answerWhen, updatedByUserId: actorUserId, updatedAt: sql`now()` } });
  });
}

// "I'm away" (since now) or "I'm back" (step 51).
export async function saveAwayNow(companyId: string, actorUserId: string, away: boolean): Promise<SetupWriteOutcome> {
  return asRestaurantOwner(companyId, actorUserId, async (tx) => {
    const awaySince = away ? sql`now()` : null;
    await tx
      .insert(assistantSettings)
      .values({ companyId, awaySince, updatedByUserId: actorUserId })
      .onConflictDoUpdate({ target: assistantSettings.companyId, set: { awaySince, updatedByUserId: actorUserId, updatedAt: sql`now()` } });
  });
}

// "Pause ansa" / "Turn ansa on" on Home: the assistant's on/off switch alone.
export async function saveAssistantStatus(companyId: string, actorUserId: string, status: AssistantStatus): Promise<SetupWriteOutcome> {
  return asRestaurantOwner(companyId, actorUserId, async (tx) => {
    await tx
      .insert(assistantSettings)
      .values({ companyId, status, updatedByUserId: actorUserId })
      .onConflictDoUpdate({ target: assistantSettings.companyId, set: { status, updatedByUserId: actorUserId, updatedAt: sql`now()` } });
  });
}

// Step 4: orders, delivery and pickup, payment and the menu's currency.
export async function saveOrdersSection(
  companyId: string,
  actorUserId: string,
  section: { takesOrders: boolean; delivery: boolean; deliveryNote: string; deliveryFeeCents: number; pickup: boolean; paymentNote: string; currency: string },
  reached: number | null,
): Promise<SetupWriteOutcome> {
  return asRestaurantOwner(companyId, actorUserId, async (tx) => {
    const columns = {
      takesOrders: section.takesOrders,
      delivery: section.delivery,
      deliveryNote: section.deliveryNote,
      deliveryFeeCents: section.deliveryFeeCents,
      pickup: section.pickup,
      paymentNote: section.paymentNote,
      currency: section.currency,
      updatedByUserId: actorUserId,
    };
    await tx
      .insert(assistantSettings)
      .values({ companyId, ...columns })
      .onConflictDoUpdate({ target: assistantSettings.companyId, set: { ...columns, updatedAt: sql`now()` } });
    await recordSetupProgressWithin(tx, companyId, reached);
  });
}

// Step 5: the owner's instructions and the holding reply. The reply mode
// stays Automatic (the default); Settings → Assistant changes it.
export async function saveAssistantSection(
  companyId: string,
  actorUserId: string,
  section: { instructions: string; holdingReply: string },
  reached: number | null,
): Promise<SetupWriteOutcome> {
  return asRestaurantOwner(companyId, actorUserId, async (tx) => {
    const columns = { instructions: section.instructions, holdingReply: section.holdingReply, updatedByUserId: actorUserId };
    await tx
      .insert(assistantSettings)
      .values({ companyId, ...columns })
      .onConflictDoUpdate({ target: assistantSettings.companyId, set: { ...columns, updatedAt: sql`now()` } });
    await recordSetupProgressWithin(tx, companyId, reached);
  });
}

// Settings → Assistant: on or paused, the reply mode, the two texts and the
// email alerts.
export async function saveAssistantSettings(
  companyId: string,
  actorUserId: string,
  settings: { status: AssistantStatus; replyMode: ReplyMode; instructions: string; holdingReply: string; alertByEmail: boolean },
): Promise<SetupWriteOutcome> {
  return asRestaurantOwner(companyId, actorUserId, async (tx) => {
    const columns = {
      status: settings.status,
      replyMode: settings.replyMode,
      instructions: settings.instructions,
      holdingReply: settings.holdingReply,
      alertByEmail: settings.alertByEmail,
      updatedByUserId: actorUserId,
    };
    await tx
      .insert(assistantSettings)
      .values({ companyId, ...columns })
      .onConflictDoUpdate({ target: assistantSettings.companyId, set: { ...columns, updatedAt: sql`now()` } });
  });
}
