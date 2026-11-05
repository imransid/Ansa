"use server";

import { revalidatePath } from "next/cache";
import { removeDeviceThroughCore, saveFollowPhoneThroughCore, startPairingThroughCore } from "@/lib/core-views/devices";
import type { FormErrors, SaveState } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import type { PairCode } from "@/lib/types/devices";

// Thin, like every action: core checks the person (owners only), the input
// and the rate limits (Settings → Your phone).

// A new code, and how many seconds it still works.
export type PairingAnswer = { pairCode?: PairCode; secondsLeft?: number; errors?: FormErrors };

// "Connect your phone": a one-time code for the ansa app to scan or type.
export async function startPairingAction(): Promise<PairingAnswer> {
  await requireSessionContext();
  const result = await startPairingThroughCore();
  if (!result.ok) {
    return { errors: result.errors };
  }
  // WHY counted here: a server's clock agrees with core's, a browser's may
  // be minutes off, and the countdown from expiresAt alone would then lie.
  const secondsLeft = Math.max(0, Math.floor((Date.parse(result.pairCode.expiresAt) - Date.now()) / 1000));
  return { pairCode: result.pairCode, secondsLeft };
}

// Remove: the phone no longer checks in, and the app forgets this account.
export async function removeDeviceAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await removeDeviceThroughCore(formData.get("deviceId"));
  // Refreshed either way: a phone someone removed first is gone from the list too.
  revalidatePath("/settings/phone");
  revalidatePath("/dashboard");
  return result.ok ? undefined : result.errors;
}

// "Answer for me when my phone is unreachable", and after how many minutes.
export async function saveFollowPhoneAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  await requireSessionContext();
  const result = await saveFollowPhoneThroughCore(formData.get("followPhone") === "on", formData.get("waitMinutes"));
  if (!result.ok) {
    return { errors: result.errors };
  }
  revalidatePath("/settings/phone");
  revalidatePath("/dashboard");
  return { saved: true };
}
