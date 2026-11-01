"use server";

import { revalidatePath } from "next/cache";
import type { FormErrors } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import { connectStandInTelegramForSession, disconnectTelegramForSession, startTelegramConnectForSession } from "@/services/telegram-connect";

// Thin, like every action: the services check the person, the mode and the
// rate limit (step 48, Settings → Connections).

export type ConnectTelegramState = { link?: string; errors?: FormErrors };

// Makes a new one-time link to ansa's bot, for the page to open.
export async function startTelegramConnectAction(): Promise<ConnectTelegramState> {
  const session = await requireSessionContext();
  const result = await startTelegramConnectForSession(session);
  return result.ok ? { link: result.link } : { errors: result.errors };
}

export async function connectStandInTelegramAction(): Promise<ConnectTelegramState> {
  const session = await requireSessionContext();
  const result = await connectStandInTelegramForSession(session);
  revalidatePath("/settings/channels");
  return result.ok ? {} : { errors: result.errors };
}

export async function disconnectTelegramAction(): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await disconnectTelegramForSession(session);
  revalidatePath("/settings/channels");
  revalidatePath("/inbox", "layout");
  return result.ok ? undefined : result.errors;
}
