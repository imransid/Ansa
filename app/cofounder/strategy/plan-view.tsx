import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import type { MarketingPlan } from "@/lib/marketing-plan/plan-schema";
import type { ShownPlan } from "@/services/marketing-strategy";
import { PlanCadence, PlanCampaigns } from "./plan-campaigns";
import { PlanAudiences, PlanGoals, PlanPillars, PlanPositioning, PlanSection, PlanTextList } from "./plan-sections";
import { PlanSources } from "./plan-sources";
import { PlanStatements } from "./plan-statements";

// One version of the marketing plan (step 37): who made it, when and from
// what, then the plan itself. The Strategy page shows the current one, and
// each version has a page of its own (strategy/[version]).
export function PlanView({ plan, title }: { plan: ShownPlan; title: string }) {
  return (
    <article className="grid gap-6" aria-labelledby="plan-title">
      <header className="grid gap-2">
        <h2 id="plan-title" className="text-lg font-semibold">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">
          Version {plan.version}, made on <LocalDateTime iso={plan.createdAt.toISOString()} dateOnly /> by{" "}
          {plan.createdByName ?? "a former teammate"} from {describeSources(plan)}.
        </p>
        {plan.goalNote && (
          <p className="text-sm whitespace-pre-wrap wrap-anywhere">
            <span className="font-medium">Asked to focus on: </span>
            {plan.goalNote}
          </p>
        )}
        {plan.profileChangedSince && (
          <p className="rounded-lg border p-3 text-sm">
            The confirmed facts on the{" "}
            <Link href="/cofounder/profile" className="underline">
              Profile page
            </Link>{" "}
            changed since this plan was made. A new plan would use them.
          </p>
        )}
      </header>
      {plan.content ? (
        <PlanContent content={plan.content} />
      ) : (
        <p className="text-sm text-muted-foreground">
          This version was saved in a form this page can no longer show. What it was made from is listed below.
        </p>
      )}
      <PlanSources plan={plan} />
    </article>
  );
}

function PlanContent({ content }: { content: MarketingPlan }) {
  return (
    <>
      <PlanSection id="plan-summary" title="Summary">
        <p className="text-sm wrap-anywhere">{content.summary}</p>
      </PlanSection>
      <PlanStatements statements={content.statements} />
      <PlanAudiences audiences={content.audiences} />
      <PlanPositioning positioning={content.positioning} />
      <PlanGoals goals={content.goals} />
      <PlanPillars pillars={content.pillars} />
      <PlanCampaigns campaigns={content.campaigns} />
      <PlanCadence cadence={content.cadence} />
      <PlanTextList
        id="plan-missing-information"
        title="What would make the plan better"
        items={content.missing_information}
        emptyText="The AI listed nothing it was missing."
      />
      <PlanTextList id="plan-cautions" title="Cautions" items={content.cautions} emptyText="The AI listed no cautions." />
    </>
  );
}

// "12 confirmed facts, 2 knowledge articles and your support trends".
function describeSources(plan: ShownPlan): string {
  const sources = [countOf(plan.factsUsed.length, "confirmed fact")];
  if (plan.knowledgeUsed.length > 0) {
    sources.push(countOf(plan.knowledgeUsed.length, "knowledge article"));
  }
  if (plan.usedSupportTrends) {
    sources.push("your support trends");
  }
  return sources.length === 1 ? sources[0] : `${sources.slice(0, -1).join(", ")} and ${sources.at(-1)}`;
}

function countOf(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}
