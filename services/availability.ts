import "server-only";
import { getAssistantSettings } from "@/db/assistant-settings";
import type { Availability } from "@/lib/assistant/availability";
import { isOpeningHours } from "@/lib/opening-hours";

// When this company's assistant answers (step 51), from its settings.
export async function readAvailability(companyId: string): Promise<Availability> {
  const settings = await getAssistantSettings(companyId);
  return {
    answerWhen: settings?.answerWhen ?? "always",
    awaySince: settings?.awaySince ?? null,
    awayHours: isOpeningHours(settings?.awayHours) ? settings.awayHours : null,
    timeZone: settings?.timeZone ?? null,
    replyGraceMinutes: settings?.replyGraceMinutes ?? null,
  };
}
