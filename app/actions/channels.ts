"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  connectStandInTelegramThroughCore,
  connectStandInWhatsAppThroughCore,
  connectWhatsAppThroughCore,
  disconnectTelegramThroughCore,
  disconnectWhatsAppThroughCore,
  startTelegramConnectThroughCore,
} from "@/lib/core-views/channels";
import type { FormErrors } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";

// Thin, like every action: core checks the person, the mode and the rate limit
// (step 48, Settings → Connections).

export type ConnectTelegramState = { link?: string; errors?: FormErrors };

// Makes a new one-time link to ansa's bot, for the page to open.
export async function startTelegramConnectAction(): Promise<ConnectTelegramState> {
  await requireSessionContext();
  const result = await startTelegramConnectThroughCore();
  return result.ok ? { link: result.link } : { errors: result.errors };
}

export async function connectStandInTelegramAction(): Promise<ConnectTelegramState> {
  await requireSessionContext();
  const result = await connectStandInTelegramThroughCore();
  revalidatePath("/settings/channels");
  return result.ok ? {} : { errors: result.errors };
}

export async function disconnectTelegramAction(): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await disconnectTelegramThroughCore();
  revalidatePath("/settings/channels");
  revalidatePath("/inbox", "layout");
  return result.ok ? undefined : result.errors;
}

// WhatsApp (step 56): what Meta's sign-up window reported. Only a shape
// check here: core asks Meta whether each value is true before saving.
const whatsappSignupInput = z.object({
  code: z.string().min(1).max(2_000),
  wabaId: z.string().regex(/^[0-9]{1,40}$/),
  phoneNumberId: z.string().regex(/^[0-9]{1,40}$/),
});

export type ConnectWhatsAppState = { connected?: boolean; error?: string };

export async function connectWhatsAppAction(signup: { code: string; wabaId: string; phoneNumberId: string }): Promise<ConnectWhatsAppState> {
  await requireSessionContext();
  const parsed = whatsappSignupInput.safeParse(signup);
  if (!parsed.success) {
    return { error: "Meta's sign-up didn't finish. Press Connect WhatsApp again." };
  }
  const result = await connectWhatsAppThroughCore(parsed.data);
  revalidatePath("/settings/channels");
  return result.ok ? { connected: true } : { error: result.errors.message ?? "That didn't work. Try again." };
}

export async function connectStandInWhatsAppAction(): Promise<ConnectTelegramState> {
  await requireSessionContext();
  const result = await connectStandInWhatsAppThroughCore();
  revalidatePath("/settings/channels");
  return result.ok ? {} : { errors: result.errors };
}

export async function disconnectWhatsAppAction(): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await disconnectWhatsAppThroughCore();
  revalidatePath("/settings/channels");
  revalidatePath("/inbox", "layout");
  return result.ok ? undefined : result.errors;
}
