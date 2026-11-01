import "server-only";
import { getAssistantSettings } from "@/db/assistant-settings";
import { getLiveTelegramConnection } from "@/db/channel-connections";
import { countMenuItems } from "@/db/menu";
import { getCompanySetup } from "@/db/restaurant-setup";
import { canManageRestaurant } from "@/lib/restaurant-permissions";
import type { SessionContext } from "@/lib/session";
import { getEngineState } from "./assistant-engine";
import { getInboxForSession } from "./conversations";
import { listAssigneeChoicesForSession } from "./team";

// Home's two lists that point somewhere (the "easy to use" pass of
// 2026-11-01): what an owner still has to do before ansa can answer, and the
// conversations that wait for a person, each one by name.

export type GettingStartedStep = {
  key: "channel" | "engine" | "menu" | "instructions";
  done: boolean;
  // What to do, as a link's words.
  label: string;
  href: string;
  // What was found, once it's done.
  doneText: string;
};

// The few things that make ansa answer at all, in the order to do them.
// Owners only (members can't do them); an empty list once all are done.
export async function getGettingStartedForSession(session: SessionContext): Promise<GettingStartedStep[]> {
  if (!canManageRestaurant(session.role)) {
    return [];
  }
  const [company, telegram, engine, settings, menuItems] = await Promise.all([
    getCompanySetup(session.companyId),
    getLiveTelegramConnection(session.companyId),
    getEngineState(session.companyId),
    getAssistantSettings(session.companyId),
    countMenuItems(session.companyId),
  ]);
  const steps: GettingStartedStep[] = [
    {
      key: "channel",
      done: telegram !== null && telegram.status === "connected",
      label: telegram ? "Let ansa reply on Telegram" : "Connect Telegram, where people write to you",
      href: "/settings/channels",
      doneText: telegram?.isStandIn ? "A stand-in Telegram account is connected (development)." : "Telegram is connected.",
    },
    {
      key: "engine",
      done: engine.ready,
      label: "Choose the AI that writes ansa's replies",
      href: "/settings/assistant#engine-heading",
      doneText: "The AI is ready.",
    },
  ];
  if (company.kind === "business") {
    steps.push({ key: "menu", done: menuItems > 0, label: "Add what you sell and its prices", href: "/settings/menu", doneText: `${menuItems} on your menu.` });
  } else {
    steps.push({
      key: "instructions",
      done: (settings?.instructions ?? "") !== "",
      label: "Tell ansa what it may say for you",
      href: "/settings/assistant#instructions",
      doneText: "ansa knows what it may say.",
    });
  }
  return steps.every((step) => step.done) ? [] : steps;
}

// How many conversations Home lists by name; the rest are one click away.
const NEEDS_YOU_SHOWN = 5;

// The newest conversations that need a person, how many there are, and
// whether requests can be shared out (more than one person takes them:
// otherwise "nobody on it" only repeats the conversations listed).
export async function getNeedsYouForSession(session: SessionContext) {
  const [{ rows, counts }, team] = await Promise.all([getInboxForSession(session, "needs-you", 1), listAssigneeChoicesForSession(session)]);
  return { rows: rows.slice(0, NEEDS_YOU_SHOWN), total: counts["needs-you"], hasTeam: team.length > 1 };
}
