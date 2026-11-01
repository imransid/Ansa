import "server-only";
import { z } from "zod";
import { getAssistantSettings, saveAssistantSettings } from "@/db/assistant-settings";
import { getCompanySetup } from "@/db/restaurant-setup";
import type { FormResult } from "@/lib/form-result";
import { isAwayNow } from "@/lib/assistant/availability";
import { describeHoursNow, isOpeningHours } from "@/lib/opening-hours";
import { canManageRestaurant } from "@/lib/restaurant-permissions";
import { describeReplyMode, type CompanyKind } from "@/lib/restaurant-setup";
import type { SessionContext } from "@/lib/session";
import { assistantSettingsSchema } from "@/lib/validation/restaurant-setup";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// The assistant's own settings (Settings → Assistant, step 45) and what the
// app says about it at a glance: the sidebar's hours and reply mode, and
// whether Home sends an owner to the setup first.

// What the sidebar shows under the restaurant's name.
export type AssistantGlance = {
  // "Open until 23:00", "Closed today", ...; null before hours are set.
  hours: { open: boolean; text: string } | null;
  // "Answers on its own", "Asks you first" or "Paused".
  mode: string;
};

// Saves Settings → Assistant for the session's company. Owners only.
export async function saveAssistantSettingsForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  if (!canManageRestaurant(session.role)) {
    return { ok: false, errors: { message: "Only owners can change the assistant." } };
  }
  if (await isOverRateLimit("settings-changes", session.userId, RATE_LIMITS.settingsChangesPerUser)) {
    return { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };
  }
  const parsed = assistantSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  const outcome = await saveAssistantSettings(session.companyId, session.userId, parsed.data);
  return outcome === "saved" ? { ok: true } : { ok: false, errors: { message: "Only owners can change the assistant." } };
}

// Today's hours (in the restaurant's own time zone) and the reply mode of the
// session's company, as of `now`.
export async function getAssistantGlanceForSession(session: SessionContext, now = new Date()): Promise<AssistantGlance> {
  const settings = await getAssistantSettings(session.companyId);
  const mode = glanceMode(settings, now);
  if (!settings?.timeZone || !isOpeningHours(settings.openingHours)) {
    return { hours: null, mode };
  }
  return { hours: describeHoursNow(settings.openingHours, settings.timeZone, now), mode };
}

// Whether the session's company finished its setup, and whether this person
// can do it (owners) or only wait for an owner (members).
export async function getSetupStateForSession(session: SessionContext): Promise<{ finished: boolean; canSetUp: boolean; kind: CompanyKind }> {
  const company = await getCompanySetup(session.companyId);
  return { finished: company.setupFinishedAt !== null, canSetUp: canManageRestaurant(session.role), kind: company.kind };
}

// "Paused", or (step 51) whether ansa answers for you right now when it
// answers only while you're away, else the reply mode.
function glanceMode(settings: Awaited<ReturnType<typeof getAssistantSettings>>, now: Date): string {
  if (settings?.status !== "paused" && settings?.answerWhen === "when_away") {
    const away = isAwayNow(
      {
        answerWhen: settings.answerWhen,
        awaySince: settings.awaySince,
        awayHours: isOpeningHours(settings.awayHours) ? settings.awayHours : null,
        timeZone: settings.timeZone,
        replyGraceMinutes: settings.replyGraceMinutes,
      },
      now,
    );
    return away ? "Away: ansa answers for you" : "Available: you answer";
  }
  return describeReplyMode(settings?.status ?? "on", settings?.replyMode ?? "automatic");
}
