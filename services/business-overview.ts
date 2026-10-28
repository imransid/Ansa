import "server-only";
import { getCofounderOverviewCounts, getSupportOverviewCounts, type CofounderOverviewCounts, type SupportOverviewCounts } from "@/db/business-overview";
import { getCofounderProgress, type CofounderProgress } from "@/db/cofounder-progress";
import { listSocialConnections } from "@/db/social-connections";
import { canManageBusinessProfile } from "@/lib/cofounder/permissions";
import { measureProfileCompletion } from "@/lib/cofounder/profile-status";
import type { SessionContext } from "@/lib/session";
import { getFactValuesForSession } from "./business-profile";
import { connectionStatusAsOfNow } from "./social-accounts";

// The dashboard's "Business overview" (step 43): a few numbers from both
// halves of ansa, support and the Co-Founder, each a link to the page that
// lists them. Real counts of the session's company only, each read with a
// bounded query (db/business-overview.ts). Everyone in the company sees
// them: every page they link to is readable by members too.

// Re-exported so the page can use the types without importing from /db.
export type { SupportOverviewCounts };

export type CofounderOverviewNumbers = CofounderOverviewCounts & {
  keyFactsConfirmed: number;
  keyFactsTotal: number;
  // Connected accounts whose access ended (or the platform refused), as the
  // Accounts page works it out as of now.
  accountsNeedingReconnect: number;
};

export type BusinessOverview = {
  support: SupportOverviewCounts;
  // null: the company hasn't started the Co-Founder yet (no fact, interview
  // answer or draft): the page shows one line inviting an owner instead.
  cofounder: CofounderOverviewNumbers | null;
  // Only owners answer the interview, so only they are invited to start.
  canStartCofounder: boolean;
};

// Gathers the overview of the session's company.
export async function getBusinessOverviewForSession(session: SessionContext, now = new Date()): Promise<BusinessOverview> {
  const [support, progress] = await Promise.all([getSupportOverviewCounts(session.companyId, session.userId), getCofounderProgress(session.companyId)]);
  const canStartCofounder = canManageBusinessProfile(session.role);
  if (!hasStartedCofounder(progress)) {
    return { support, cofounder: null, canStartCofounder };
  }
  const [counts, factValues, connections] = await Promise.all([
    getCofounderOverviewCounts(session.companyId),
    getFactValuesForSession(session),
    listSocialConnections(session.companyId),
  ]);
  const completion = measureProfileCompletion(factValues);
  const accountsNeedingReconnect = connections.filter((connection) => connectionStatusAsOfNow(connection, now) === "needs_reauth").length;
  return {
    support,
    cofounder: { ...counts, keyFactsConfirmed: completion.keyConfirmed, keyFactsTotal: completion.keyTotal, accountsNeedingReconnect },
    canStartCofounder,
  };
}

// Says whether a company has started the Co-Founder: any fact, interview
// answer or draft. WHY the interview counts too: an owner who answered while
// the AI was unavailable has no fact yet, but has started.
export function hasStartedCofounder(progress: CofounderProgress): boolean {
  return progress.hasFacts || progress.hasInterviewMessages || progress.hasDrafts;
}
