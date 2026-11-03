"use server";

import { z } from "zod";
import {
  findPracticeChatFromCore,
  readPracticeChatFromCore,
  sendPracticeEmailThroughCore,
  sendPracticeMessageThroughCore,
  type PracticeEmail,
  type PracticeEmailSent,
  type PracticeLine,
  type PracticeSent,
} from "@/lib/core-views/practice-chat";
import { requireSessionContext } from "@/lib/session";

// Thin, like every action: core checks the person (an owner), that this is a
// development server, the input and the limits. The practice chat page
// calls these from its form and while it waits for ansa's answer.

const PAGE = "/settings/channels/practice-chat";

const sendInput = z.object({
  channel: z.enum(["whatsapp", "telegram", "messenger"]),
  name: z.string().trim().min(1).max(100),
  text: z.string().trim().min(1).max(4000),
});

export async function sendPracticeMessageAction(input: { channel: string; name: string; text: string }): Promise<PracticeSent> {
  await requireSessionContext(PAGE);
  const parsed = sendInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Write the customer's name and a message." };
  }
  return sendPracticeMessageThroughCore(parsed.data.channel, parsed.data.name, parsed.data.text);
}

export async function readPracticeChatAction(input: { conversationId: string }): Promise<PracticeLine[] | null> {
  await requireSessionContext(PAGE);
  const parsed = z.object({ conversationId: z.string().uuid() }).safeParse(input);
  return parsed.success ? readPracticeChatFromCore(parsed.data.conversationId) : null;
}

export async function findPracticeChatAction(input: { channel: string; name: string }): Promise<string> {
  await requireSessionContext(PAGE);
  const parsed = sendInput.pick({ channel: true, name: true }).safeParse(input);
  return parsed.success ? findPracticeChatFromCore(parsed.data.channel, parsed.data.name) : "";
}

// The practice email's fields, as long as core allows them (core checks the
// address and every field again: core/internal/api/practice_email.go).
const emailInput = z.object({
  name: z.string().trim().max(100),
  address: z.string().trim().min(1).max(320),
  subject: z.string().trim().min(1).max(1000),
  text: z.string().trim().min(1).max(100_000),
  verified: z.boolean(),
});

export async function sendPracticeEmailAction(input: PracticeEmail): Promise<PracticeEmailSent> {
  await requireSessionContext(PAGE);
  const parsed = emailInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Write the sender's address, a subject and the email.", fields: {} };
  }
  return sendPracticeEmailThroughCore(parsed.data);
}
