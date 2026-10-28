import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { labelOfTopic } from "@/lib/business-facts";
import type { PlanStatement } from "@/lib/marketing-plan/plan-schema";
import { STATEMENT_BASIS_LABELS, STATEMENT_BASIS_MEANINGS, statementBases, type StatementBasis } from "@/lib/marketing-plan/statement-bases";

// The plan's main points (step 37), each with its basis as a badge, and the
// legend that says what Fact, Assumption and Suggestion mean. A "Fact" here
// always names confirmed facts the plan was made from: the code checked it
// (lib/marketing-plan/fact-basis.ts), not the AI. Whether its text says what
// they say is not checked, and the legend says so.
export function PlanStatements({ statements }: { statements: PlanStatement[] }) {
  return (
    <section className="grid gap-3" aria-labelledby="plan-statements">
      <h3 id="plan-statements" className="font-semibold">Main points</h3>
      <BasisLegend />
      <ul className="grid gap-2">
        {statements.map((statement, index) => (
          <li key={index} className="grid gap-1 rounded-lg border p-3">
            <div className="flex flex-wrap items-start gap-2">
              <Badge variant={badgeVariantFor(statement.basis)}>{STATEMENT_BASIS_LABELS[statement.basis]}</Badge>
              <p className="min-w-0 flex-1 text-sm wrap-anywhere">{statement.text}</p>
            </div>
            {statement.fact_topics.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {statement.basis === "fact" ? "From the confirmed facts: " : "Related facts: "}
                {statement.fact_topics.map(labelOfTopic).join(", ")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// Two columns, so every meaning starts beside the widest badge.
function BasisLegend() {
  return (
    <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {statementBases.map((basis) => (
        <Fragment key={basis}>
          <dt>
            <Badge variant={badgeVariantFor(basis)}>{STATEMENT_BASIS_LABELS[basis]}</Badge>
          </dt>
          <dd className="min-w-0">{STATEMENT_BASIS_MEANINGS[basis]}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

// A fact stands out; an assumption is drawn as an outline, something to check.
function badgeVariantFor(basis: StatementBasis): "default" | "outline" | "secondary" {
  switch (basis) {
    case "fact":
      return "default";
    case "assumption":
      return "outline";
    case "suggestion":
      return "secondary";
  }
}
