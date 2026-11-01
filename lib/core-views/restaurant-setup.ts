import "server-only";
import { cache } from "react";
import { callCore } from "@/lib/core-api";
import type { FormErrors } from "@/lib/form-result";
import { hoursFieldName, RANGES_PER_DAY, WEEKDAYS } from "@/lib/opening-hours";
import type { CompanyKind, SetupStepKey } from "@/lib/restaurant-setup";
import type { RestaurantProfile, SetupSection } from "@/services/restaurant-setup";

// The setup at /welcome, Settings → What it knows and Settings → Assistant
// through the new backend (core's GET /api/v1/setup and POST
// /api/v1/setup/{section}), in the shapes the pages and forms already read.

type CoreSettings = Omit<RestaurantProfile["settings"], "awaySince">;

type CoreSetup = {
  profile: Omit<RestaurantProfile, "canManage" | "settings"> & { settings: CoreSettings };
  canManage: boolean;
};

// One read per request: the sidebar's links, the bottom bar's and the page
// may all ask.
const readSetupFromCore = cache(() => callCore<CoreSetup>("GET", "/api/v1/setup"));

export async function getRestaurantProfileFromCore(): Promise<RestaurantProfile> {
  const answer = await readSetupFromCore();
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  return toProfile(answer.data);
}

// Whether setup is finished, and whether this person can do it (Home, Settings).
export async function getSetupStateFromCore(): Promise<{ finished: boolean; canSetUp: boolean; kind: CompanyKind }> {
  const profile = await getRestaurantProfileFromCore();
  return { finished: profile.setupFinished, canSetUp: profile.canManage, kind: profile.kind };
}

// Whether the sidebar shows Orders: a business that takes orders through
// ansa. Without an answer, the links show without Orders (as while loading).
export async function showsOrdersFromCore(): Promise<boolean> {
  const answer = await readSetupFromCore();
  return answer.ok && answer.data.profile.kind === "business" && answer.data.profile.settings.takesOrders;
}

// Each field named, so nothing else core sends (the engine, the key's last
// four) travels with the profile.
function toProfile({ profile, canManage }: CoreSetup): RestaurantProfile {
  const settings = profile.settings;
  return {
    kind: profile.kind,
    companyName: profile.companyName,
    businessType: profile.businessType,
    description: profile.description,
    address: profile.address,
    setupProgress: profile.setupProgress,
    setupFinished: profile.setupFinished,
    canManage,
    settings: {
      status: settings.status,
      replyMode: settings.replyMode,
      holdingReply: settings.holdingReply,
      instructions: settings.instructions,
      takesOrders: settings.takesOrders,
      timeZone: settings.timeZone,
      openingHours: settings.openingHours,
      delivery: settings.delivery,
      deliveryNote: settings.deliveryNote,
      deliveryFeeCents: settings.deliveryFeeCents,
      pickup: settings.pickup,
      paymentNote: settings.paymentNote,
      currency: settings.currency,
      publicPhone: settings.publicPhone,
      alertByEmail: settings.alertByEmail,
      answerWhen: settings.answerWhen,
      // Core's settings don't carry it, and no page reading this profile
      // shows it (Home's status card reads services/away.ts's Presence).
      awaySince: null,
      awayHours: settings.awayHours,
      replyGraceMinutes: settings.replyGraceMinutes,
    },
  };
}

type SectionSaved = { ok: true; nextStep: SetupStepKey } | { ok: false; errors: FormErrors };

// Saves one section of the form; from the setup it also counts as that step done.
export async function saveSetupSectionThroughCore(section: SetupSection, formData: FormData, from: "setup" | "settings"): Promise<SectionSaved> {
  const query = from === "setup" ? "?from=setup" : "";
  const answer = await callCore<{ nextStep: SetupStepKey }>("POST", `/api/v1/setup/${section}${query}`, sectionBody(section, formData));
  return answer.ok ? { ok: true, nextStep: answer.data.nextStep } : { ok: false, errors: coreFormErrors(answer) };
}

// Each section's fields as core reads them (core/internal/setup).
function sectionBody(section: SetupSection, formData: FormData): unknown {
  switch (section) {
    case "business":
      return {
        kind: textOf(formData, "kind"),
        companyName: textOf(formData, "companyName"),
        // A person has no business type; an empty choice is none.
        businessType: textOf(formData, "businessType") || null,
        description: textOf(formData, "description"),
      };
    case "contact":
      return { address: textOf(formData, "address"), phone: textOf(formData, "phone") };
    case "hours":
    case "away":
      return hoursSectionBody(formData, section === "away");
    case "orders":
      return {
        takesOrders: isTicked(formData, "takesOrders"),
        delivery: isTicked(formData, "delivery"),
        deliveryNote: textOf(formData, "deliveryNote"),
        deliveryFee: textOf(formData, "deliveryFee"),
        pickup: isTicked(formData, "pickup"),
        paymentNote: textOf(formData, "paymentNote"),
        currency: textOf(formData, "currency"),
      };
    case "assistant":
      return { instructions: textOf(formData, "instructions"), holdingReply: textOf(formData, "holdingReply") };
  }
}

// "Continue" past the channels step, and "Open ansa" at the end.
export async function finishSetupStepThroughCore(step: "connect" | "finish"): Promise<{ ok: true } | { ok: false; errors: FormErrors }> {
  const answer = await callCore("POST", `/api/v1/setup/${step}`);
  return answer.ok ? { ok: true } : { ok: false, errors: coreFormErrors(answer) };
}

// What the setup's channels step shows: the forwarding address, and how
// many phone lines ansa answers (core's GET /api/v1/channels).
export async function getChannelsStepFromCore(): Promise<{ forwardingAddress: string; phoneLineCount: number }> {
  const answer = await callCore<{ page: { forwardingAddress: string; phoneLines: unknown[] } }>("GET", "/api/v1/channels");
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  return { forwardingAddress: answer.data.page.forwardingAddress, phoneLineCount: answer.data.page.phoneLines.length };
}

// The hours form's fields as core reads them: each day's typed times, the
// time zone, and (away hours only) the minutes ansa waits.
function hoursSectionBody(formData: FormData, away: boolean): unknown {
  const hours: Record<string, { opens: string; closes: string }[]> = {};
  for (const { key } of WEEKDAYS) {
    hours[key] = [];
    for (let range = 1; range <= RANGES_PER_DAY; range++) {
      hours[key].push({ opens: textOf(formData, hoursFieldName(key, range, "opens")), closes: textOf(formData, hoursFieldName(key, range, "closes")) });
    }
  }
  const body: Record<string, unknown> = { timeZone: textOf(formData, "timeZone"), hours };
  if (away) {
    body.replyGraceMinutes = graceMinutesOf(textOf(formData, "replyGraceMinutes"));
  }
  return body;
}

// "" = never steps in. Anything but a number of minutes is sent as -1, so
// core refuses it ("Choose how long ansa waits.") instead of reading "never".
function graceMinutesOf(typed: string): number | null {
  if (typed === "") {
    return null;
  }
  return /^\d{1,3}$/.test(typed) ? Number(typed) : -1;
}

// A form value as the forms send it: text, or nothing.
function textOf(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

// A ticked checkbox sends "on"; an unticked one sends nothing.
function isTicked(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

// Core's refusal as the forms show it: a problem under each field it names
// ("form" is the whole form's, shown at the top), else its one message.
export function coreFormErrors(refusal: { message: string; fields: Record<string, string> }): FormErrors {
  const { form, ...fields } = refusal.fields;
  const names = Object.keys(fields);
  if (names.length === 0) {
    return { message: form ?? refusal.message };
  }
  const fieldErrors: Record<string, string[]> = {};
  for (const name of names) {
    fieldErrors[name] = [fields[name]];
  }
  return form ? { fieldErrors, message: form } : { fieldErrors };
}
