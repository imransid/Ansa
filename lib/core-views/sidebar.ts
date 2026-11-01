import "server-only";
import { callCore } from "@/lib/core-api";
import type { AssistantGlance } from "@/services/assistant-settings";
import type { DashboardSummary } from "@/services/dashboard";

// The sidebar's foot through the new backend (core's GET /api/v1/glance),
// in the shapes it already reads: who you are and your company, what ansa
// does now and today's hours.

type CoreGlance = {
  glance: { companyName: string; mode: string; hours: AssistantGlance["hours"] };
  userName: string;
  email: string;
  role: DashboardSummary["role"];
};

// null without an answer: the foot then shows its placeholder, as while loading.
export async function getSidebarFootFromCore(): Promise<{ summary: DashboardSummary; glance: AssistantGlance } | null> {
  const answer = await callCore<CoreGlance>("GET", "/api/v1/glance");
  if (!answer.ok) {
    return null;
  }
  const { glance, userName, email, role } = answer.data;
  return {
    summary: { userName, email, role, companyName: glance.companyName },
    glance: { mode: glance.mode, hours: glance.hours },
  };
}
