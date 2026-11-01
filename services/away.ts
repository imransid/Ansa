import "server-only";
import { z } from "zod";
import { getAssistantSettings, saveAnswerWhen, saveAssistantStatus, saveAwayNow } from "@/db/assistant-settings";
import { listAwaySummary, markAwaySummarySeen, type AwaySummaryLine } from "@/db/away-summary";
import { setContactImportant } from "@/db/contact-importance";
import { getCompanySetup } from "@/db/restaurant-setup";
import { describeCover, isAwayNow, type Availability } from "@/lib/assistant/availability";
import type { FormResult } from "@/lib/form-result";
import { canManageRestaurant } from "@/lib/restaurant-permissions";
import type { AssistantStatus, CompanyKind } from "@/lib/restaurant-setup";
import type { SessionContext } from "@/lib/session";
import { conversationIdSchema } from "@/lib/validation/conversations";
import { answerWhenSchema } from "@/lib/validation/restaurant-setup";
import { readAvailability } from "./availability";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// Being away (step 51): "I'm away" / "I'm back" on Home, "Always" or "Only
// when I'm away" on Settings → Assistant, the people who always come to
// you, and "While you were away" on Home. Owners change when ansa answers
// (it speaks for the account); anyone in the company marks someone
// important and reads the summary, as they work conversations.

export type Presence = {
  kind: CompanyKind;
  // "paused": ansa answers nobody (Settings → Assistant, or Home's "Pause ansa").
  status: AssistantStatus;
  availability: Availability;
  awayNow: boolean;
  // A few words: "You're away: ansa answers".
  coverText: string;
  canManage: boolean;
};

export async function getPresenceForSession(session: SessionContext, now = new Date()): Promise<Presence> {
  const [availability, company, settings] = await Promise.all([
    readAvailability(session.companyId),
    getCompanySetup(session.companyId),
    getAssistantSettings(session.companyId),
  ]);
  return {
    kind: company.kind,
    status: settings?.status ?? "on",
    availability,
    awayNow: isAwayNow(availability, now),
    coverText: describeCover(availability, now),
    canManage: canManageRestaurant(session.role),
  };
}

// "I'm away" (away: "on") or "I'm back".
export async function setAwayForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = z.object({ away: z.enum(["on", "off"]) }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "Something went wrong. Reload the page." } };
  }
  if (!canManageRestaurant(session.role)) {
    return { ok: false, errors: { message: "Only owners say when ansa answers." } };
  }
  if (await isOverRateLimit("settings-changes", session.userId, RATE_LIMITS.settingsChangesPerUser)) {
    return { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };
  }
  const outcome = await saveAwayNow(session.companyId, session.userId, parsed.data.away === "on");
  return outcome === "saved" ? { ok: true } : { ok: false, errors: { message: "Only owners say when ansa answers." } };
}

// "Pause ansa" (status: "paused") or "Turn ansa on", from Home.
export async function setAssistantStatusForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = z.object({ status: z.enum(["on", "paused"]) }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "Something went wrong. Reload the page." } };
  }
  if (!canManageRestaurant(session.role)) {
    return { ok: false, errors: { message: "Only owners can pause or start ansa." } };
  }
  if (await isOverRateLimit("settings-changes", session.userId, RATE_LIMITS.settingsChangesPerUser)) {
    return { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };
  }
  const outcome = await saveAssistantStatus(session.companyId, session.userId, parsed.data.status);
  return outcome === "saved" ? { ok: true } : { ok: false, errors: { message: "Only owners can pause or start ansa." } };
}

// "Always" or "Only when I'm away".
export async function saveAnswerWhenForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  if (!canManageRestaurant(session.role)) {
    return { ok: false, errors: { message: "Only owners say when ansa answers." } };
  }
  if (await isOverRateLimit("settings-changes", session.userId, RATE_LIMITS.settingsChangesPerUser)) {
    return { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };
  }
  const parsed = answerWhenSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  const outcome = await saveAnswerWhen(session.companyId, session.userId, parsed.data.answerWhen);
  return outcome === "saved" ? { ok: true } : { ok: false, errors: { message: "Only owners say when ansa answers." } };
}

// What the assistant did since this person last pressed "Got it": each
// conversation once (its newest line), and how many replies and notes.
export async function getAwaySummaryForSession(session: SessionContext) {
  const { since, lines } = await listAwaySummary(session.companyId, session.userId, 200);
  const byConversation = new Map<string, AwaySummaryLine>();
  for (const line of lines) {
    if (!byConversation.has(line.conversationId)) {
      byConversation.set(line.conversationId, line);
    }
  }
  return {
    since,
    replies: lines.filter((line) => line.action === "replied").length,
    notes: lines.filter((line) => line.action === "handed_over").length,
    waiting: lines.filter((line) => line.action === "drafted").length,
    conversations: [...byConversation.values()].slice(0, 8),
  };
}

export async function markAwaySummarySeenForSession(session: SessionContext): Promise<FormResult> {
  const outcome = await markAwaySummarySeen(session.companyId, session.userId);
  return outcome === "saved" ? { ok: true } : { ok: false, errors: { message: "You can no longer work this company's conversations." } };
}

// Marks the person behind a conversation important, or not.
export async function setImportantForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = z.object({ conversationId: conversationIdSchema, important: z.enum(["on", "off"]) }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "This conversation isn't there any more. Reload the page." } };
  }
  if (await isOverRateLimit("inbox-changes", session.userId, RATE_LIMITS.inboxChangesPerUser)) {
    return { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };
  }
  const outcome = await setContactImportant(session.companyId, session.userId, parsed.data.conversationId, parsed.data.important === "on");
  if (outcome === "saved") {
    return { ok: true };
  }
  return { ok: false, errors: { message: outcome === "not-found" ? "This conversation isn't there any more. Reload the page." : "You can no longer work this company's conversations." } };
}
