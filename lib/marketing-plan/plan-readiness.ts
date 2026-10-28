import type { BusinessFactTopic } from "@/lib/business-facts";

// What a marketing plan can't be made without (step 37): what the business
// does, what it sells (products or services: either is enough, as many
// businesses only have one) and who it sells to. Only confirmed facts count:
// a proposal is the AI's reading of an answer, not yet the owner's word.
// Without them Claude is never asked. Pure, so the page, the service and
// the checks agree.

export type MissingPlanFact = {
  label: string;
  // The profile topics that would fill it (any one of them does).
  topics: BusinessFactTopic[];
};

const NEEDED_FOR_A_PLAN: MissingPlanFact[] = [
  { label: "What the business does", topics: ["description"] },
  { label: "Products or services", topics: ["products", "services"] },
  { label: "Target customers", topics: ["target_customers"] },
];

// What is still missing for a plan, in the order above (none: ready).
export function findMissingPlanFacts(confirmedTopics: ReadonlySet<BusinessFactTopic>): MissingPlanFact[] {
  return NEEDED_FOR_A_PLAN.filter((needed) => !needed.topics.some((topic) => confirmedTopics.has(topic)));
}
