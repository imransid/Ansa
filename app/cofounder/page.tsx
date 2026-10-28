import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import { buttonVariants } from "@/components/ui/button";
import { canManageBusinessProfile, canManageMarketingStrategy } from "@/lib/cofounder/permissions";
import { requireSessionContext } from "@/lib/session";
import { getCoFounderOverviewForSession, type CoFounderNextStep, type CoFounderOverview } from "@/services/cofounder-overview";
import { GettingStartedChecklist } from "./getting-started";
import { ProfileCompletionSummary } from "./profile-completion";

export const metadata: Metadata = { title: "Co-Founder - ansa" };

export default function CoFounderPage() {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 p-6">
      {/* Cache Components rule: the session is only known at request time,
          so it is read inside <Suspense>. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <OverviewContent />
      </Suspense>
    </main>
  );
}

// What the Co-Founder does, how complete the business profile is, and what
// to do next (step 36). Real counts only.
async function OverviewContent() {
  const session = await requireSessionContext("/cofounder");
  const overview = await getCoFounderOverviewForSession(session);
  // Hiding the next steps is only for a tidy page: the services refuse members.
  const isOwner = canManageBusinessProfile(session.role);

  return (
    <>
      <section className="grid gap-3">
        <h1 className="text-xl font-semibold">Co-Founder</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Your AI Co-Founder is here to help with your marketing, and it starts with what it needs most: the facts about
          your business. Answer its interview one question at a time, or fill in the profile yourself. What the AI reads
          from an answer or a knowledge article is only a proposal until an owner confirms it; only confirmed facts
          count, and the marketing plan is made from them.
        </p>
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Getting started</h2>
        <GettingStartedChecklist steps={overview.checklist} />
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Business profile</h2>
        <ProfileCompletionSummary completion={overview.completion} />
        <p className="text-sm text-muted-foreground">{describeInterview(overview)}</p>
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Marketing plan</h2>
        <StrategyStatus strategy={overview.strategy} canMakePlans={canManageMarketingStrategy(session.role)} />
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">What to do next</h2>
        {isOwner ? (
          <NextSteps steps={overview.nextSteps} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Only owners answer the interview and confirm facts. You can read both:{" "}
            <Link href="/cofounder/interview" className="underline">
              the interview
            </Link>{" "}
            and{" "}
            <Link href="/cofounder/profile" className="underline">
              the business profile
            </Link>
            .
          </p>
        )}
      </section>
    </>
  );
}

// Where the marketing plan stands (step 37), with the way to the Strategy page.
function StrategyStatus({ strategy, canMakePlans }: { strategy: CoFounderOverview["strategy"]; canMakePlans: boolean }) {
  const { currentPlan, missingForPlan } = strategy;
  if (currentPlan) {
    return (
      <div className="grid justify-items-start gap-2">
        <p className="text-sm text-muted-foreground">
          The current plan is version {currentPlan.version}, made on <LocalDateTime iso={currentPlan.createdAt.toISOString()} dateOnly />.
        </p>
        <Link href="/cofounder/strategy" className={buttonVariants({ size: "sm", variant: "outline" })}>
          Open the marketing plan
        </Link>
      </div>
    );
  }
  if (missingForPlan.length > 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No plan yet. A plan needs these facts confirmed first: {missingForPlan.map((fact) => fact.label).join(", ")}. See{" "}
        <Link href="/cofounder/strategy" className="underline">
          the Strategy page
        </Link>
        .
      </p>
    );
  }
  return (
    <div className="grid justify-items-start gap-2">
      <p className="text-sm text-muted-foreground">
        No plan yet: the profile has what a plan needs.{canMakePlans ? "" : " An owner can make the first one."}
      </p>
      <Link href={canMakePlans ? "/cofounder/strategy#new-plan" : "/cofounder/strategy"} className={buttonVariants({ size: "sm", variant: "outline" })}>
        {canMakePlans ? "Make the first plan" : "Open the Strategy page"}
      </Link>
    </div>
  );
}

function describeInterview(overview: CoFounderOverview): string {
  if (!overview.interviewStarted) {
    return "The interview hasn't started yet.";
  }
  return overview.interviewFinished
    ? "The interview covered every key fact. More answers can still add details."
    : "The interview is under way: it goes on where it was left.";
}

// The most useful step first, as a button; the others as plain links.
function NextSteps({ steps }: { steps: CoFounderNextStep[] }) {
  return (
    <ol className="grid max-w-3xl gap-4">
      {steps.map((step, index) => (
        <li key={step.label} className="grid justify-items-start gap-1">
          <Link href={step.href} className={buttonVariants({ size: "sm", variant: index === 0 ? "default" : "outline" })}>
            {step.label}
          </Link>
          <p className="text-sm text-muted-foreground">{step.description}</p>
        </li>
      ))}
    </ol>
  );
}
