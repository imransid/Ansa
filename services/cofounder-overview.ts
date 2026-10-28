import "server-only";
import { getCofounderProgress } from "@/db/cofounder-progress";
import { listMarketingPlanVersions } from "@/db/marketing-plans";
import { getInterviewState } from "@/db/onboarding-messages";
import { listSocialConnections } from "@/db/social-connections";
import { buildGettingStartedSteps, type GettingStartedStep } from "@/lib/cofounder/getting-started";
import { canManageBusinessProfile } from "@/lib/cofounder/permissions";
import type { ProfileCompletion } from "@/lib/cofounder/profile-status";
import { findMissingPlanFacts, type MissingPlanFact } from "@/lib/marketing-plan/plan-readiness";
import type { SessionContext } from "@/lib/session";
import { getBusinessProfileForSession, type BusinessProfile } from "./business-profile";
import { connectionStatusAsOfNow } from "./social-accounts";

// The Co-Founder's Overview page (step 36): how complete the business
// profile is, what an owner should do next, (step 37) where the marketing
// plan stands, and (step 43) the checklist from a first interview answer to
// a post's numbers. Real counts and real state only.

export type CoFounderNextStep = { label: string; href: string; description: string };

export type CoFounderOverview = {
  completion: ProfileCompletion;
  missingKeyTopics: BusinessProfile["missingKeyTopics"];
  interviewStarted: boolean;
  interviewFinished: boolean;
  // Owners only (members can't do any of it), most useful first.
  nextSteps: CoFounderNextStep[];
  // The current marketing plan (null: none yet), and what a plan still needs.
  strategy: { currentPlan: { version: number; createdAt: Date } | null; missingForPlan: MissingPlanFact[] };
  // Everyone reads it: each step names the page where it is done.
  checklist: GettingStartedStep[];
};

// How many missing topics a next step names before "and N more".
const MISSING_TOPICS_NAMED = 3;

// Gathers the Overview of the session's company.
export async function getCoFounderOverviewForSession(session: SessionContext, now = new Date()): Promise<CoFounderOverview> {
  const [profile, interview, [newestPlan], progress, connections] = await Promise.all([
    getBusinessProfileForSession(session),
    getInterviewState(session.companyId),
    listMarketingPlanVersions(session.companyId, 1),
    getCofounderProgress(session.companyId),
    listSocialConnections(session.companyId),
  ]);
  const profileTopics = profile.groups.flatMap((group) => group.topics);
  const confirmedTopics = new Set(profileTopics.filter((topic) => topic.confirmed !== null).map((topic) => topic.topic));
  // As on the Interview page: a key proposal dismissed after the closing
  // message makes its topic missing again, and the interview goes on.
  const interviewFinished = interview.finished && profile.missingKeyTopics.length === 0;
  const connected = connections.filter((connection) => connectionStatusAsOfNow(connection, now) === "connected");
  const overview = {
    completion: profile.completion,
    missingKeyTopics: profile.missingKeyTopics,
    interviewStarted: interview.started,
    interviewFinished,
    strategy: {
      currentPlan: newestPlan ? { version: newestPlan.version, createdAt: newestPlan.createdAt } : null,
      missingForPlan: findMissingPlanFacts(confirmedTopics),
    },
    checklist: buildGettingStartedSteps({
      interviewStarted: interview.started,
      interviewFinished,
      completion: profile.completion,
      planVersion: newestPlan?.version ?? null,
      hasWrittenDraft: progress.hasWrittenDraft,
      connectedAccounts: connected.length,
      standInAccounts: connected.filter((connection) => connection.isStandIn).length,
      accountsNeedingReconnect: connections.filter((connection) => connectionStatusAsOfNow(connection, now) === "needs_reauth").length,
      hasScheduledPost: progress.hasScheduledPost,
      hasPostNumbers: progress.hasPostNumbers,
    }),
  };
  return { ...overview, nextSteps: canManageBusinessProfile(session.role) ? buildNextSteps(overview) : [] };
}

// Proposals first: confirming is quick, and until then the AI's reading of
// the answers is not the owner's word. Then the interview, while a key
// topic has nothing at all. Then, with everything confirmed, the profile.
function buildNextSteps(overview: Omit<CoFounderOverview, "nextSteps">): CoFounderNextStep[] {
  const steps: CoFounderNextStep[] = [];
  const waiting = overview.completion.proposalsWaiting;
  if (waiting > 0) {
    steps.push({
      label: waiting === 1 ? "Confirm 1 proposed fact" : `Confirm ${waiting} proposed facts`,
      href: "/cofounder/profile",
      description: "The AI read them from your answers or your knowledge base. Confirm, edit or dismiss each one.",
    });
  }
  if (overview.missingKeyTopics.length > 0) {
    steps.push({
      label: overview.interviewStarted ? "Continue the interview" : "Start the interview",
      href: "/cofounder/interview",
      description: `Still missing: ${describeMissing(overview.missingKeyTopics.map((topic) => topic.label))}. You can also fill them in yourself on the Profile page.`,
    });
  }
  const { keyConfirmed, keyTotal } = overview.completion;
  if (keyConfirmed === keyTotal && waiting === 0) {
    steps.push({
      label: "Review your business profile",
      href: "/cofounder/profile",
      description: "Every key fact is confirmed. Add the other topics, or keep the facts up to date as the business changes.",
    });
  }
  return steps;
}

function describeMissing(labels: string[]): string {
  const named = labels.slice(0, MISSING_TOPICS_NAMED).join(", ");
  const more = labels.length - MISSING_TOPICS_NAMED;
  return more > 0 ? `${named} and ${more} more` : named;
}
