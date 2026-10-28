import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { canManageMarketingStrategy } from "@/lib/cofounder/permissions";
import { requireSessionContext } from "@/lib/session";
import { getStrategyPageForSession, type MarketingStrategy } from "@/services/marketing-strategy";
import { MissingFacts } from "../missing-facts";
import { NewPlanForm } from "./new-plan-form";
import { PlanVersions } from "./plan-versions";
import { PlanView } from "./plan-view";
import { SupportTrendsSetting } from "./support-trends-setting";

export const metadata: Metadata = { title: "Strategy - Co-Founder - ansa" };

// "Make a new plan" asks Claude inside this page's server action (one try
// of up to 4.5 minutes): the host's default time limit can be as short as
// 10 seconds.
export const maxDuration = 300;

export default function StrategyPage() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-8 p-6">
      {/* Cache Components rule: the session is only known at request time,
          so it is read inside <Suspense>. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <StrategyContent />
      </Suspense>
    </main>
  );
}

// The company's marketing plan (step 37): the current version, a new one
// for owners, and every version. Members read; owners make plans.
async function StrategyContent() {
  const session = await requireSessionContext("/cofounder/strategy");
  const page = await getStrategyPageForSession(session);
  // Hiding the form and the checkbox is only for a tidy page: the services
  // and /db refuse members.
  const isOwner = canManageMarketingStrategy(session.role);

  return (
    <>
      <section className="grid gap-3">
        <h1 className="text-xl font-semibold">Marketing strategy</h1>
        <p className="text-sm text-muted-foreground">
          The Co-Founder writes a marketing plan for your business from the facts confirmed on the{" "}
          <Link href="/cofounder/profile" className="underline">
            Profile page
          </Link>
          , your approved knowledge articles ticked for marketing and the newest{" "}
          <Link href="/cofounder/analytics" className="underline">
            performance review
          </Link>{" "}
          of your posts. It marks each main point as a fact, an assumption or
          a suggestion. It is told never to invent results or customers and never to promise sales, but it can still get
          things wrong: check each point before you act on it. Every new plan is a new version; older ones are kept.
        </p>
        {isOwner && page.current && (
          <a href="#new-plan" className="text-sm underline">
            Make a new plan
          </a>
        )}
      </section>

      {page.current ? <PlanView plan={page.current} title="Current plan" /> : <NoPlanYet page={page} isOwner={isOwner} />}

      <section className="grid gap-4" aria-labelledby="new-plan">
        <h2 id="new-plan" className="scroll-mt-6 text-lg font-semibold">
          {newPlanHeading(page, isOwner)}
        </h2>
        <NewPlanSection page={page} isOwner={isOwner} />
        <SupportTrendsSetting enabled={page.usesSupportTrends} isOwner={isOwner} />
      </section>

      <PlanVersions versions={page.versions} newestVersion={page.newestVersion} />
    </>
  );
}

function NoPlanYet({ page, isOwner }: { page: MarketingStrategy; isOwner: boolean }) {
  const ready = page.missingForPlan.length === 0;
  return (
    <section className="grid gap-2" aria-labelledby="plan-title">
      <h2 id="plan-title" className="text-lg font-semibold">
        Current plan
      </h2>
      <p className="text-sm text-muted-foreground">
        There is no plan yet.{" "}
        {ready && isOwner ? "Your profile has what a plan needs: make the first one below." : ""}
        {ready && !isOwner ? "An owner can make the first one." : ""}
      </p>
    </section>
  );
}

function newPlanHeading(page: MarketingStrategy, isOwner: boolean): string {
  if (!isOwner) {
    return "New plans";
  }
  return page.current ? "Make a new plan" : "Make the first plan";
}

// What can be done about a new plan: what is still missing, the form for
// owners, or a note for members.
function NewPlanSection({ page, isOwner }: { page: MarketingStrategy; isOwner: boolean }) {
  if (page.missingForPlan.length > 0) {
    return <MissingFacts missing={page.missingForPlan} isOwner={isOwner} writes="a plan" />;
  }
  if (!isOwner) {
    return <p className="text-sm text-muted-foreground">Only owners make plans. You can read every version here.</p>;
  }
  return <NewPlanForm hasPlan={page.current !== null} />;
}
