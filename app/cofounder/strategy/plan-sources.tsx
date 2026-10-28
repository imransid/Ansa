import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import { SUPPORT_TREND_DAYS } from "@/lib/marketing-plan/limits";
import type { ShownPlan } from "@/services/marketing-strategy";

// What one version was made from (step 37), so it stays clear later what it
// was based on: the confirmed facts as they were then, the knowledge
// articles it read, the performance review it read (step 42), and whether
// it saw the support trends. Folded away: the plan comes first.
export function PlanSources({ plan }: { plan: ShownPlan }) {
  return (
    <details className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium">What this plan was made from</summary>
      <div className="mt-3 grid gap-4">
        <section className="grid gap-2" aria-label="Confirmed facts">
          <h4 className="font-medium">Confirmed facts ({plan.factsUsed.length})</h4>
          <dl className="grid gap-2">
            {plan.factsUsed.map((fact) => (
              <div key={fact.topic} className="grid gap-0.5">
                <dt className="text-muted-foreground">{fact.label}</dt>
                <dd className="whitespace-pre-wrap wrap-anywhere">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="grid gap-2" aria-label="Knowledge articles">
          <h4 className="font-medium">Knowledge articles ({plan.knowledgeUsed.length})</h4>
          {plan.knowledgeUsed.length === 0 ? (
            <p className="text-muted-foreground">No approved article ticked for marketing matched what the business sells and wants.</p>
          ) : (
            <ul className="grid list-disc gap-1 pl-5 wrap-anywhere">
              {plan.knowledgeUsed.map((article) => (
                <li key={article.articleId}>
                  {article.title === null ? (
                    <span className="text-muted-foreground">A deleted article</span>
                  ) : (
                    <Link href={`/knowledge/${article.articleId}`} className="underline">
                      {article.title}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <p>
          <span className="font-medium">Past performance: </span>
          {plan.pastPerformance ? (
            <>
              the findings of the performance review made <LocalDateTime iso={plan.pastPerformance.reviewedAt.toISOString()} dateOnly />, of the
              posts that went out from <LocalDateTime iso={plan.pastPerformance.periodStart.toISOString()} dateOnly /> to{" "}
              <LocalDateTime iso={plan.pastPerformance.periodEnd.toISOString()} dateOnly /> (only numbers the platforms gave; see{" "}
              <Link href="/cofounder/analytics" className="underline">
                Analytics
              </Link>
              ).
            </>
          ) : (
            "none: there was no performance review yet."
          )}
        </p>
        <p>
          <span className="font-medium">Support trends: </span>
          {plan.usedSupportTrends
            ? `the number of tickets per category in the ${SUPPORT_TREND_DAYS} days before the plan was made (names and numbers only).`
            : "not used: the setting was off."}
        </p>
      </div>
    </details>
  );
}
