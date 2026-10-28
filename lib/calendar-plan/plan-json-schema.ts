import { contentFormats } from "@/lib/content-studio/formats";
import { socialPlatforms } from "@/lib/social-platforms";

// The JSON schema the API enforces for "Plan the next 2 weeks" (step 41):
// the keys of plan-answer.ts, every field required, nothing else allowed.
// Keep the two in sync: scripts/tenant-isolation/calendar-plan-checks.ts
// checks it. There is deliberately no company, draft, status or approval
// field: Claude only proposes ideas. No lengths or counts (structured
// outputs don't support them): the prompt says them, plan-answer.ts keeps to them.

const TEXT = { type: "string" };

export function buildCalendarPlanJsonSchema() {
  const post = objectOf({
    date: TEXT,
    time: TEXT,
    platform: { type: "string", enum: [...socialPlatforms] },
    format: { type: "string", enum: [...contentFormats] },
    pillar: TEXT,
    campaign: TEXT,
    topic: TEXT,
  });
  return objectOf({ posts: { type: "array", items: post } });
}

// An object whose every property is required, with no other property allowed.
function objectOf(properties: Record<string, unknown>) {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}
