"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveAssistantSettingsThroughCore } from "@/lib/core-views/assistant";
import { finishSetupStepThroughCore, saveSetupSectionThroughCore } from "@/lib/core-views/restaurant-setup";
import { withTypedValues, type SaveState } from "@/lib/form-result";
import { hoursFieldName, RANGES_PER_DAY, WEEKDAYS } from "@/lib/opening-hours";
import { requireSessionContext } from "@/lib/session";
import type { SetupSection } from "@/lib/types/restaurant-setup";

// Thin, like every action: core checks the owner, the input and the
// rate limit. Each section form says where it was sent from (a hidden
// "from" field): from the setup at /welcome a save moves on to the next
// step; from Settings it says "Saved." That field only picks where the
// browser goes next, never what is saved or who may save it.

export async function saveBusinessSectionAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  return saveSection("business", formData, ["kind", "companyName", "businessType", "description"]);
}

export async function saveContactSectionAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  return saveSection("contact", formData, ["address", "phone"]);
}

// Opening hours, or (step 51, the form's hidden "which") the hours ansa
// answers for you, with how long it waits for you to answer yourself.
export async function saveHoursSectionAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  const away = formData.get("which") === "away";
  // Every box of the week is sent back as typed when core refuses the form.
  const fields = ["timeZone", "replyGraceMinutes"];
  for (const { key } of WEEKDAYS) {
    for (let range = 1; range <= RANGES_PER_DAY; range++) {
      fields.push(hoursFieldName(key, range, "opens"), hoursFieldName(key, range, "closes"));
    }
  }
  return saveSection(away ? "away" : "hours", formData, fields);
}

export async function saveOrdersSectionAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  return saveSection("orders", formData, ["takesOrders", "delivery", "pickup", "deliveryNote", "deliveryFee", "paymentNote", "currency"]);
}

export async function saveAssistantSectionAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  return saveSection("assistant", formData, ["instructions", "holdingReply"]);
}

export async function saveAssistantSettingsAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  await requireSessionContext();
  const result = await saveAssistantSettingsThroughCore(formData);
  if (!result.ok) {
    return { errors: withTypedValues(result.errors, formData, ["instructions", "holdingReply"]) };
  }
  revalidateRestaurantPages();
  return { saved: true };
}

export async function completeChannelsStepAction(_previous: SaveState | undefined): Promise<SaveState> {
  await requireSessionContext();
  const result = await finishSetupStepThroughCore("connect");
  if (!result.ok) {
    return { errors: result.errors };
  }
  redirect("/welcome?step=ready");
}

export async function finishSetupAction(_previous: SaveState | undefined): Promise<SaveState> {
  await requireSessionContext();
  const result = await finishSetupStepThroughCore("finish");
  if (!result.ok) {
    return { errors: result.errors };
  }
  revalidateRestaurantPages();
  redirect("/dashboard");
}

async function saveSection(section: SetupSection, formData: FormData, typedFields: string[]): Promise<SaveState> {
  await requireSessionContext();
  const from = formData.get("from") === "setup" ? "setup" : "settings";
  const result = await saveSetupSectionThroughCore(section, formData, from);
  if (!result.ok) {
    return { errors: withTypedValues(result.errors, formData, typedFields) };
  }
  revalidateRestaurantPages();
  if (from === "setup") {
    redirect(`/welcome?step=${result.nextStep}`);
  }
  return { saved: true };
}


// The pages that show what these forms change, the sidebar's hours and mode
// (every signed-in layout) included.
function revalidateRestaurantPages(): void {
  revalidatePath("/", "layout");
}
