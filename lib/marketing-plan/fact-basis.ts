import { PLAN_LIST_LIMITS } from "./limits";
import type { MarketingPlan, PlanStatement } from "./plan-schema";

// The rule that keeps "Fact" honest (step 37). Claude labels each statement
// of a plan fact, assumption or suggestion, but it can't check itself
// against the business profile; this code can. A "fact" counts only when it
// names the confirmed facts it repeats, and every one of them was among the
// confirmed facts sent with the request. Otherwise (no topic named, a topic
// that isn't confirmed, a proposal, an unknown key) it is stored and shown
// as an assumption. Pure.

// The plan with the rule applied to every statement. Each statement then
// names only topics that were sent (they are what the page lists under it).
export function applyFactBasisRule(plan: MarketingPlan, sentTopics: ReadonlySet<string>): MarketingPlan {
  return { ...plan, statements: plan.statements.map((statement) => applyRuleToStatement(statement, sentTopics)) };
}

function applyRuleToStatement(statement: PlanStatement, sentTopics: ReadonlySet<string>): PlanStatement {
  const named = statement.fact_topics;
  const everyNamedTopicWasSent = named.length > 0 && named.every((topic) => sentTopics.has(topic));
  return {
    text: statement.text,
    basis: statement.basis === "fact" && !everyNamedTopicWasSent ? "assumption" : statement.basis,
    fact_topics: named.filter((topic) => sentTopics.has(topic)).slice(0, PLAN_LIST_LIMITS.factTopics.max),
  };
}
