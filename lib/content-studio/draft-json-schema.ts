import { businessFactTopics } from "@/lib/business-facts";

// The JSON schema the API enforces for one content draft (step 38): the
// keys of draft-answer.ts, every field required, nothing else allowed.
// Keep the two in sync: scripts/tenant-isolation/content-generation-checks.ts
// checks it. There is deliberately no "supported" field on a claim (this
// code decides that, lib/content-studio/claims.ts), and no company, draft,
// version or person field. No lengths or counts: structured outputs don't
// support them, so the prompt tells Claude the limits and draft-answer.ts
// cleans what comes back.

const TEXT = { type: "string" };

export function buildContentDraftJsonSchema() {
  return objectOf({
    title: TEXT,
    body: TEXT,
    hashtags: { type: "array", items: TEXT },
    call_to_action: TEXT,
    image_prompt: TEXT,
    video_script: TEXT,
    claims: {
      type: "array",
      items: objectOf({ text: TEXT, fact_topics: { type: "array", items: { type: "string", enum: [...businessFactTopics] } } }),
    },
  });
}

// An object whose every property is required, with no other property allowed.
function objectOf(properties: Record<string, unknown>) {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}
