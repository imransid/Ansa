import "server-only";
import { z } from "zod";
import { getAssistantSettings, saveAssistantSection, saveAwaySection, saveHoursSection, saveOrdersSection, type AssistantSettingsRow, type AwaySection } from "@/db/assistant-settings";
import { getBusinessFactsForCompany } from "@/db/business-facts";
import { finishSetup, getCompanySetup, recordChannelsStepDone, saveBusinessSection, saveContactSection } from "@/db/restaurant-setup";
import type { SetupWriteOutcome } from "@/db/restaurant-owner";
import type { FormResult } from "@/lib/form-result";
import { isOpeningHours, type OpeningHours } from "@/lib/opening-hours";
import { canManageRestaurant } from "@/lib/restaurant-permissions";
import { DEFAULT_HOLDING_REPLY, setupStepNumber, setupStepsFor, type BusinessType, type CompanyKind, type SetupStepKey } from "@/lib/restaurant-setup";
import type { SessionContext } from "@/lib/session";
import {
  assistantSectionSchema,
  businessSectionSchema,
  contactSectionSchema,
  hoursSectionSchema,
  ordersSectionSchema,
  replyGraceSchema,
} from "@/lib/validation/restaurant-setup";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// The restaurant setup (step 45): what a new owner fills in at /welcome, one
// step at a time, and the same sections on Settings → What it knows and
// Assistant. Owners change it; everyone in the company reads it.

// Everything the setup and Settings pages show, with the defaults filled in
// for what was never saved.
export type RestaurantProfile = {
  // A business, or one person (step 50).
  kind: CompanyKind;
  companyName: string;
  businessType: BusinessType | null;
  // Business facts (the owner's confirmed values), "" when none.
  description: string;
  address: string;
  settings: AssistantSettingsView;
  setupProgress: number;
  setupFinished: boolean;
  canManage: boolean;
};

// The settings as pages read them: no ids, no dates.
// The AI engine and the restaurant's key are Settings → Assistant's own
// (services/assistant-engine.ts): never part of this view.
export type AssistantSettingsView = Omit<
  AssistantSettingsRow,
  | "companyId"
  | "updatedByUserId"
  | "createdAt"
  | "updatedAt"
  | "openingHours"
  | "awayHours"
  | "aiEngine"
  | "anthropicKeyEncrypted"
  | "anthropicKeyHint"
  // "Post for me" (step 54) has its own page: services/autopost.ts.
  | "autopostEnabled"
  | "autopostFrequency"
  | "autopostTime"
  | "autopostMode"
  | "autopostEnabledByUserId"
  | "autopostEnabledAt"
> & {
  openingHours: OpeningHours | null;
  awayHours: OpeningHours | null;
};

// The sections a form saves, in the order of the setup.
export type SetupSection = Extract<SetupStepKey, "business" | "contact" | "hours" | "away" | "orders" | "assistant">;

// A save that worked says which setup step comes next (for its kind).
export type SetupSaveResult = { ok: true; nextStep: SetupStepKey } | Extract<FormResult, { ok: false }>;

// The column defaults of assistant_settings (db/schema/assistant-settings.ts),
// for a company that saved none yet.
const DEFAULT_SETTINGS: AssistantSettingsView = {
  status: "on",
  replyMode: "automatic",
  holdingReply: DEFAULT_HOLDING_REPLY,
  instructions: "",
  takesOrders: true,
  timeZone: null,
  openingHours: null,
  delivery: false,
  deliveryNote: "",
  deliveryFeeCents: 0,
  pickup: true,
  paymentNote: "",
  currency: null,
  publicPhone: null,
  alertByEmail: true,
  answerWhen: "always",
  awaySince: null,
  awayHours: null,
  replyGraceMinutes: null,
};

const ownersOnly: Extract<FormResult, { ok: false }> = { ok: false, errors: { message: "Only owners can change ansa's setup." } };
const tooManyChanges: Extract<FormResult, { ok: false }> = { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };

// Reads the session company's setup, settings and the facts setup writes.
export async function getRestaurantProfileForSession(session: SessionContext): Promise<RestaurantProfile> {
  const [company, settings, facts] = await Promise.all([
    getCompanySetup(session.companyId),
    getAssistantSettings(session.companyId),
    getBusinessFactsForCompany(session.companyId),
  ]);
  const factOf = (topic: string) => facts.find((fact) => fact.topic === topic)?.confirmedValue ?? "";
  return {
    kind: company.kind,
    companyName: company.companyName,
    businessType: company.businessType,
    description: factOf("description"),
    address: factOf("location"),
    settings: settings ? toSettings(settings) : DEFAULT_SETTINGS,
    setupProgress: company.setupProgress,
    setupFinished: company.setupFinishedAt !== null,
    canManage: canManageRestaurant(session.role),
  };
}

function toSettings(row: AssistantSettingsRow): AssistantSettingsView {
  return {
    status: row.status,
    replyMode: row.replyMode,
    holdingReply: row.holdingReply,
    instructions: row.instructions,
    takesOrders: row.takesOrders,
    timeZone: row.timeZone,
    // Hours in a shape this code doesn't write are shown as not set.
    openingHours: isOpeningHours(row.openingHours) ? row.openingHours : null,
    delivery: row.delivery,
    deliveryNote: row.deliveryNote,
    deliveryFeeCents: row.deliveryFeeCents,
    pickup: row.pickup,
    paymentNote: row.paymentNote,
    currency: row.currency,
    publicPhone: row.publicPhone,
    alertByEmail: row.alertByEmail,
    answerWhen: row.answerWhen,
    awaySince: row.awaySince,
    awayHours: isOpeningHours(row.awayHours) ? row.awayHours : null,
    replyGraceMinutes: row.replyGraceMinutes,
  };
}

// Saves one section of the session company's setup, from /welcome (`from`
// "setup": it also counts as that step done) or from Settings. Owners only.
// The first section also picks who ansa is for (a business or a person),
// and the steps after it follow that choice.
export async function saveSetupSectionForSession(
  session: SessionContext,
  section: SetupSection,
  input: unknown,
  from: "setup" | "settings",
): Promise<SetupSaveResult> {
  if (!canManageRestaurant(session.role)) {
    return ownersOnly;
  }
  if (await isOverRateLimit("settings-changes", session.userId, RATE_LIMITS.settingsChangesPerUser)) {
    return tooManyChanges;
  }
  const kindBefore = (await getCompanySetup(session.companyId)).kind;
  const reached = from === "setup" ? setupStepNumber(section, kindBefore) : null;
  const outcome = await parseAndSave(session, section, input, reached);
  if (typeof outcome !== "string") {
    return outcome;
  }
  if (outcome !== "saved") {
    return ownersOnly;
  }
  const kind = (await getCompanySetup(session.companyId)).kind;
  const steps = setupStepsFor(kind);
  const index = steps.findIndex((step) => step.key === section);
  return { ok: true, nextStep: steps[Math.min(index + 1, steps.length - 1)].key };
}

// Each section with its own schema and its own write.
async function parseAndSave(
  session: SessionContext,
  section: SetupSection,
  input: unknown,
  reached: number | null,
): Promise<SetupWriteOutcome | Extract<FormResult, { ok: false }>> {
  const { companyId, userId } = session;
  if (section === "business") {
    const parsed = businessSectionSchema.safeParse(input);
    return parsed.success ? saveBusinessSection(companyId, userId, parsed.data, reached) : fieldErrors(parsed.error);
  }
  if (section === "away") {
    const parsed = parseAwaySection(input);
    return parsed.ok ? saveAwaySection(companyId, userId, parsed.data, reached) : parsed;
  }
  if (section === "contact") {
    const parsed = contactSectionSchema.safeParse(input);
    return parsed.success ? saveContactSection(companyId, userId, parsed.data, reached) : fieldErrors(parsed.error);
  }
  if (section === "hours") {
    const parsed = hoursSectionSchema.safeParse(input);
    return parsed.success ? saveHoursSection(companyId, userId, parsed.data, reached) : fieldErrors(parsed.error);
  }
  if (section === "orders") {
    const parsed = ordersSectionSchema.safeParse(input);
    return parsed.success ? saveOrdersSection(companyId, userId, parsed.data, reached) : fieldErrors(parsed.error);
  }
  const parsed = assistantSectionSchema.safeParse(input);
  return parsed.success ? saveAssistantSection(companyId, userId, parsed.data, reached) : fieldErrors(parsed.error);
}

// "Your channels" has nothing to save: moving past it counts as done.
export async function completeChannelsStepForSession(session: SessionContext): Promise<FormResult> {
  if (!canManageRestaurant(session.role)) {
    return ownersOnly;
  }
  const { kind } = await getCompanySetup(session.companyId);
  return describeOutcome(await recordChannelsStepDone(session.companyId, session.userId, setupStepNumber("connect", kind)));
}

// Finishes the session company's setup ("Your assistant is ready"), once
// every step was saved. Owners only.
export async function finishSetupForSession(session: SessionContext): Promise<FormResult> {
  if (!canManageRestaurant(session.role)) {
    return ownersOnly;
  }
  const outcome = await finishSetup(session.companyId, session.userId);
  if (outcome === "not-ready") {
    return { ok: false, errors: { message: "A setup step is still missing. Go back and save it first." } };
  }
  return describeOutcome(outcome);
}

function describeOutcome(outcome: SetupWriteOutcome): FormResult {
  return outcome === "saved" ? { ok: true } : ownersOnly;
}

function fieldErrors(error: z.ZodError): Extract<FormResult, { ok: false }> {
  return { ok: false, errors: { fieldErrors: z.flattenError(error).fieldErrors } };
}

// The away section (step 51): the away hours with their time zone, each
// day's mistake next to its day, and the minutes ansa waits for you.
function parseAwaySection(input: unknown): { ok: true; data: AwaySection } | Extract<FormResult, { ok: false }> {
  const hours = hoursSectionSchema.safeParse(input);
  const grace = replyGraceSchema.safeParse((input as { replyGraceMinutes?: unknown })?.replyGraceMinutes);
  if (!hours.success || !grace.success) {
    const errors = { ...(hours.success ? {} : z.flattenError(hours.error).fieldErrors), ...(grace.success ? {} : { replyGraceMinutes: ["Choose how long ansa waits."] }) };
    return { ok: false, errors: { fieldErrors: errors } };
  }
  return { ok: true, data: { timeZone: hours.data.timeZone, awayHours: hours.data.openingHours, replyGraceMinutes: grace.data } };
}
