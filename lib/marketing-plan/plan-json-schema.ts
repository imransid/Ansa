import { businessFactTopics } from "@/lib/business-facts";
import { socialPlatforms } from "@/lib/social-platforms";
import { statementBases } from "./statement-bases";

// The JSON schema the API enforces for a marketing plan (step 37): the keys
// of plan-schema.ts, every field required, nothing else allowed. Keep the
// two in sync: scripts/tenant-isolation/marketing-plan-answer-checks.ts
// checks it. No lengths or counts here: structured outputs don't support
// them, so plan-schema.ts cuts texts and lists instead, and the prompt tells
// Claude the limits.

const TEXT = { type: "string" };
const TEXT_LIST = { type: "array", items: TEXT };
const PLATFORM = { type: "string", enum: [...socialPlatforms] };

export function buildMarketingPlanJsonSchema() {
  return objectOf({
    summary: TEXT,
    audiences: listOf({ name: TEXT, needs: TEXT, where_to_reach: TEXT }),
    positioning: TEXT,
    goals: listOf({ goal: TEXT, how_to_measure: TEXT }),
    pillars: listOf({ name: TEXT, description: TEXT, example_topics: TEXT_LIST }),
    campaigns: listOf({
      name: TEXT,
      objective: TEXT,
      pillar: TEXT,
      platforms: { type: "array", items: PLATFORM },
      timing: TEXT,
      call_to_action: TEXT,
    }),
    cadence: listOf({ platform: PLATFORM, posts_per_week: { type: "number" }, formats: TEXT_LIST }),
    statements: listOf({
      text: TEXT,
      basis: { type: "string", enum: [...statementBases] },
      fact_topics: { type: "array", items: { type: "string", enum: [...businessFactTopics] } },
    }),
    missing_information: TEXT_LIST,
    cautions: TEXT_LIST,
  });
}

// An object whose every property is required, with no other property allowed.
function objectOf(properties: Record<string, unknown>) {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

// A list of such objects.
function listOf(properties: Record<string, unknown>) {
  return { type: "array", items: objectOf(properties) };
}
