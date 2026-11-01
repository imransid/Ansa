import type { Availability } from "@/lib/assistant/availability";
import type { AssistantStatus, CompanyKind } from "@/lib/restaurant-setup";
import type { AwaySummaryLine } from "@/lib/types/away-summary";

// Being away (step 51) as Home shows it: what ansa does right now, and
// "While you were away".

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

// What the assistant did since this person last pressed "Got it": each
// conversation once (its newest line), and how many replies and notes.
export type AwaySummary = {
  // When they last pressed "Got it" (a day ago, before the first time).
  since: Date;
  replies: number;
  notes: number;
  // Replies written and waiting for a person ("Ask me first").
  waiting: number;
  // At most 8, newest first.
  conversations: AwaySummaryLine[];
};
