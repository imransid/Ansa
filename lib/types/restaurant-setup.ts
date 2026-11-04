import type { OpeningHours } from "@/lib/opening-hours";
import type { BusinessType, CompanyKind, SetupStepKey } from "@/lib/restaurant-setup";
import type { AssistantSettingsRow } from "@/lib/types/assistant-settings";

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
// (lib/types/assistant-engine.ts): never part of this view.
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
  // "Post for me" (step 54) has its own page: lib/types/autopost.ts.
  | "autopostEnabled"
  | "autopostFrequency"
  | "autopostTime"
  | "autopostMode"
  | "autopostEnabledByUserId"
  | "autopostEnabledAt"
  // Answering comments on Facebook posts has its own switch:
  // core's /api/v1/comments/settings.
  | "commentsOn"
  // The ansa phone app has its own page: core's /api/v1/devices.
  | "followPhone"
  | "phoneWaitMinutes"
  | "awaySetBy"
  | "awayChangedAt"
> & {
  openingHours: OpeningHours | null;
  awayHours: OpeningHours | null;
};

// The sections a form saves, in the order of the setup.
export type SetupSection = Extract<SetupStepKey, "business" | "contact" | "hours" | "away" | "orders" | "assistant">;
