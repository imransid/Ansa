"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTypedValues, type SaveState } from "@/lib/form-result";
import { hoursFieldName, RANGES_PER_DAY, WEEKDAYS } from "@/lib/opening-hours";
import { requireSessionContext } from "@/lib/session";
import { saveAssistantSettingsForSession } from "@/services/assistant-settings";
import {
  completeChannelsStepForSession,
  finishSetupForSession,
  saveSetupSectionForSession,
  type SetupSection,
} from "@/services/restaurant-setup";

// Thin, like every action: the services check the owner, the input and the
// rate limit. Each section form says where it was sent from (a hidden
// "from" field): from the setup at /welcome a save moves on to the next
// step; from Settings it says "Saved." That field only picks where the
// browser goes next, never what is saved or who may save it.

export async function saveBusinessSectionAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  const fields = ["kind", "companyName", "businessType", "description"];
  return saveSection("business", formData, fields, Object.fromEntries(fields.map((name) => [name, formData.get(name)])));
}

export async function saveContactSectionAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  const fields = ["address", "phone"];
  return saveSection("contact", formData, fields, Object.fromEntries(fields.map((name) => [name, formData.get(name)])));
}

// Opening hours, or (step 51, the form's hidden "which") the hours ansa
// answers for you, with how long it waits for you to answer yourself.
export async function saveHoursSectionAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  const away = formData.get("which") === "away";
  const input: Record<string, unknown> = { timeZone: formData.get("timeZone"), replyGraceMinutes: formData.get("replyGraceMinutes") };
  const fields = ["timeZone", "replyGraceMinutes"];
  for (const { key } of WEEKDAYS) {
    const ranges = [];
    for (let range = 1; range <= RANGES_PER_DAY; range++) {
      const opens = hoursFieldName(key, range, "opens");
      const closes = hoursFieldName(key, range, "closes");
      fields.push(opens, closes);
      ranges.push({ opens: textOf(formData, opens), closes: textOf(formData, closes) });
    }
    input[key] = ranges;
  }
  return saveSection(away ? "away" : "hours", formData, fields, input);
}

export async function saveOrdersSectionAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  const input = {
    takesOrders: formData.get("takesOrders"),
    delivery: formData.get("delivery"),
    deliveryNote: formData.get("deliveryNote"),
    deliveryFee: formData.get("deliveryFee"),
    pickup: formData.get("pickup"),
    paymentNote: formData.get("paymentNote"),
    currency: formData.get("currency"),
  };
  return saveSection("orders", formData, ["deliveryNote", "deliveryFee", "paymentNote", "currency"], input);
}

export async function saveAssistantSectionAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  const fields = ["instructions", "holdingReply"];
  return saveSection("assistant", formData, fields, Object.fromEntries(fields.map((name) => [name, formData.get(name)])));
}

export async function saveAssistantSettingsAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  const session = await requireSessionContext();
  const input = {
    status: formData.get("status"),
    replyMode: formData.get("replyMode"),
    instructions: formData.get("instructions"),
    holdingReply: formData.get("holdingReply"),
    alertByEmail: formData.get("alertByEmail"),
  };
  const result = await saveAssistantSettingsForSession(session, input);
  if (!result.ok) {
    return { errors: withTypedValues(result.errors, formData, ["instructions", "holdingReply"]) };
  }
  revalidateRestaurantPages();
  return { saved: true };
}

export async function completeChannelsStepAction(_previous: SaveState | undefined): Promise<SaveState> {
  const session = await requireSessionContext();
  const result = await completeChannelsStepForSession(session);
  if (!result.ok) {
    return { errors: result.errors };
  }
  redirect("/welcome?step=ready");
}

export async function finishSetupAction(_previous: SaveState | undefined): Promise<SaveState> {
  const session = await requireSessionContext();
  const result = await finishSetupForSession(session);
  if (!result.ok) {
    return { errors: result.errors };
  }
  revalidateRestaurantPages();
  redirect("/dashboard");
}

async function saveSection(section: SetupSection, formData: FormData, typedFields: string[], input: unknown): Promise<SaveState> {
  const session = await requireSessionContext();
  const from = formData.get("from") === "setup" ? "setup" : "settings";
  const result = await saveSetupSectionForSession(session, section, input, from);
  if (!result.ok) {
    return { errors: withTypedValues(result.errors, formData, typedFields) };
  }
  revalidateRestaurantPages();
  if (from === "setup") {
    redirect(`/welcome?step=${result.nextStep}`);
  }
  return { saved: true };
}

function textOf(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

// The pages that show what these forms change, the sidebar's hours and mode
// (every signed-in layout) included.
function revalidateRestaurantPages(): void {
  revalidatePath("/", "layout");
}
