import type { ReactNode } from "react";
import type { MarketingPlan } from "@/lib/marketing-plan/plan-schema";

// Who the plan is for and what it says (step 37): audiences, positioning,
// goals and content pillars. Text from the AI is shown as text, never as
// HTML (React escapes it).

export function PlanAudiences({ audiences }: { audiences: MarketingPlan["audiences"] }) {
  return (
    <PlanSection id="plan-audiences" title="Audiences">
      <ul className="grid gap-3 sm:grid-cols-2">
        {audiences.map((audience, index) => (
          <li key={index} className="grid content-start gap-1 rounded-lg border p-3 text-sm wrap-anywhere">
            <p className="font-medium">{audience.name}</p>
            <p>
              <span className="text-muted-foreground">Needs: </span>
              {audience.needs}
            </p>
            <p>
              <span className="text-muted-foreground">Where to reach them: </span>
              {audience.where_to_reach}
            </p>
          </li>
        ))}
      </ul>
    </PlanSection>
  );
}

export function PlanPositioning({ positioning }: { positioning: string }) {
  return (
    <PlanSection id="plan-positioning" title="Positioning">
      <p className="text-sm wrap-anywhere">{positioning}</p>
    </PlanSection>
  );
}

export function PlanGoals({ goals }: { goals: MarketingPlan["goals"] }) {
  return (
    <PlanSection id="plan-goals" title="Goals">
      <ul className="grid gap-2">
        {goals.map((goal, index) => (
          <li key={index} className="grid gap-1 rounded-lg border p-3 text-sm wrap-anywhere">
            <p className="font-medium">{goal.goal}</p>
            <p>
              <span className="text-muted-foreground">How to measure it: </span>
              {goal.how_to_measure}
            </p>
          </li>
        ))}
      </ul>
    </PlanSection>
  );
}

export function PlanPillars({ pillars }: { pillars: MarketingPlan["pillars"] }) {
  return (
    <PlanSection id="plan-pillars" title="Content pillars">
      <p className="text-sm text-muted-foreground">The few themes every post comes back to.</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {pillars.map((pillar, index) => (
          <li key={index} className="grid content-start gap-1 rounded-lg border p-3 text-sm wrap-anywhere">
            <p className="font-medium">{pillar.name}</p>
            <p>{pillar.description}</p>
            <p className="text-muted-foreground">Example topics:</p>
            <ul className="grid list-disc gap-0.5 pl-5">
              {pillar.example_topics.map((topic, topicIndex) => (
                <li key={topicIndex}>{topic}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </PlanSection>
  );
}

// A plain list of short texts (missing information, cautions), or a line
// saying the AI listed none.
export function PlanTextList({ id, title, items, emptyText }: { id: string; title: string; items: string[]; emptyText: string }) {
  return (
    <PlanSection id={id} title={title}>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="grid list-disc gap-1 pl-5 text-sm wrap-anywhere">
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      )}
    </PlanSection>
  );
}

// One part of the plan under its own heading (the plan's title is an h2).
export function PlanSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3" aria-labelledby={id}>
      <h3 id={id} className="font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}
