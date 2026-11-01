import { describeHoursNow, type OpeningHours } from "@/lib/opening-hours";

// When the assistant answers (step 51, the owner's direction of 2026-11-01:
// ansa is your shadow while you can't answer). "always": every message, as
// a business's assistant does by default. "when_away": only while you are
// away: you said so ("I'm away"), it is one of your away hours, or you
// didn't answer yourself within the minutes you chose. Pure.

export const ANSWER_WHEN = ["always", "when_away"] as const;
export type AnswerWhen = (typeof ANSWER_WHEN)[number];

export const ANSWER_WHEN_LABELS: Record<AnswerWhen, string> = {
  always: "Always",
  when_away: "Only when I'm away",
};

// "If I don't answer within ...": the minutes ansa waits for you.
export const REPLY_GRACE_MINUTES = [5, 10, 15, 30, 60] as const;

export type Availability = {
  answerWhen: AnswerWhen;
  // Set by "I'm away", cleared by "I'm back".
  awaySince: Date | null;
  // The weekly times ansa answers for you, in timeZone.
  awayHours: OpeningHours | null;
  timeZone: string | null;
  // null: ansa never steps in while you are available.
  replyGraceMinutes: number | null;
};

// What to do with a message that just arrived: answer it now, wait to see
// whether you answer yourself first, or leave it to you.
export type CoverDecision = { kind: "answer" } | { kind: "wait"; minutes: number } | { kind: "leave" };

export function decideCover(availability: Availability, now: Date): CoverDecision {
  if (availability.answerWhen === "always" || isAwayNow(availability, now)) {
    return { kind: "answer" };
  }
  return availability.replyGraceMinutes ? { kind: "wait", minutes: availability.replyGraceMinutes } : { kind: "leave" };
}

// You said you are away, or it is one of your away hours.
export function isAwayNow(availability: Availability, now: Date): boolean {
  if (availability.awaySince) {
    return true;
  }
  if (!availability.awayHours || !availability.timeZone) {
    return false;
  }
  return describeHoursNow(availability.awayHours, availability.timeZone, now).open;
}

// A few words for the sidebar and Home: what ansa does right now.
export function describeCover(availability: Availability, now: Date): string {
  if (availability.answerWhen === "always") {
    return "ansa answers every message";
  }
  if (isAwayNow(availability, now)) {
    return "You're away: ansa answers";
  }
  if (availability.replyGraceMinutes) {
    return `You're available: ansa answers after ${availability.replyGraceMinutes} min`;
  }
  return "You're available: you answer";
}
