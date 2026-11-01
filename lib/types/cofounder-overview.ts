import type { GettingStartedStep } from "@/lib/cofounder/getting-started";
import type { ProfileCompletion } from "@/lib/cofounder/profile-status";
import type { MissingPlanFact } from "@/lib/marketing-plan/plan-readiness";
import type { BusinessProfile } from "@/lib/types/business-profile";

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
