import { citableNumberKeys } from "./review-input";

// The JSON schema the API enforces for a performance review (step 42): the
// keys of review-answer.ts, every field required, nothing else allowed.
// Keep the two in sync: scripts/tenant-isolation/performance-review-checks.ts
// checks it. There is deliberately no company, period or person field.
// No lengths or counts (structured outputs don't support them): the prompt
// says them, review-answer.ts keeps to them and checks every number.

const TEXT = { type: "string" };

export function buildPerformanceReviewJsonSchema() {
  const evidence = objectOf({
    post_label: TEXT,
    group: TEXT,
    metric: { type: "string", enum: [...citableNumberKeys] },
    value: { type: "number" },
  });
  const finding = objectOf({ text: TEXT, evidence: { type: "array", items: evidence } });
  const recommendation = objectOf({ text: TEXT, based_on_findings: { type: "array", items: { type: "integer" } } });
  return objectOf({
    findings: { type: "array", items: finding },
    recommendations: { type: "array", items: recommendation },
    limits_of_this_data: { type: "array", items: TEXT },
  });
}

// An object whose every property is required, with no other property allowed.
function objectOf(properties: Record<string, unknown>) {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}
