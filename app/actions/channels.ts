"use server";

import { revalidatePath } from "next/cache";
import { connectStandInTelegramThroughCore, disconnectTelegramThroughCore, startTelegramConnectThroughCore } from "@/lib/core-views/channels";
import type { FormErrors } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";

// Thin, like every action: core checks the person, the mode and the
// rate limit (step 48, Settings → Connections). Each uses the new backend
// when it is switched on (lib/core-api.ts), else services/.

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
