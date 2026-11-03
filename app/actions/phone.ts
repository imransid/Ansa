"use server";

import { z } from "zod";
import {
  practiceCallTurnThroughCore,
  startPracticeCallThroughCore,
  type PracticeCallStarted,
  type PracticeCallTurn,
} from "@/lib/core-views/phone";
import { requireSessionContext } from "@/lib/session";

// Thin, like every action: core checks the person (an owner), that this is a
// development server, the input and the limits. The page calls these from
// its buttons; they never hold a password. Hanging up has its own route
// (app/api/phone/practice/end): an action would wait behind a turn.

const callId = z.string().uuid();
const startInput = z.object({ callerName: z.string().max(200), callerNumber: z.string().min(1).max(40) });
// A recording of up to about a minute (16 kHz mono WAV, base64) with the
// language spoken, or words (typed, or heard by the browser).
const turnInput = z.union([
  z.object({ callId, audio: z.string().min(1).max(3_000_000), language: z.enum(["en", "bn"]) }),
  z.object({ callId, text: z.string().max(2_000) }),
]);

const PAGE = "/settings/channels/practice-call";

export async function startPracticeCallAction(input: { callerName: string; callerNumber: string }): Promise<PracticeCallStarted> {
  await requireSessionContext(PAGE);
  const parsed = startInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Write the caller's name and a phone number." };
  }
  return startPracticeCallThroughCore(parsed.data.callerName, parsed.data.callerNumber);
}

export async function practiceCallTurnAction(
  input: { callId: string; text: string } | { callId: string; audio: string; language: "en" | "bn" },
): Promise<PracticeCallTurn> {
  await requireSessionContext(PAGE);
  const parsed = turnInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That couldn't be sent. Try again.", over: false };
  }
  const { callId: id, ...said } = parsed.data;
  return practiceCallTurnThroughCore(id, said);
}
