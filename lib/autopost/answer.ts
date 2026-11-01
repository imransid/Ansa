import { z } from "zod";
import { cleanReplyText } from "@/lib/assistant/answer";
import { cutToLength } from "@/lib/cofounder/fact-proposals";
import { toPlainSingleLine } from "@/lib/plain-text";

// The AI's "Post for me" post (step 54), read strictly: anything else is
// unusable, and nothing is posted. A body over this length is unusable too
// (cutting it could cut a sentence's meaning).
const BODY_MAX_LENGTH = 1_500;
const HASHTAGS_MAX = 4;

const answerSchema = z
  .object({
    body: z.string().max(20_000),
    call_to_action: z.string().max(2_000),
    hashtags: z.array(z.string().max(200)).max(20),
  })
  .strict();

export type AutopostText = { body: string; callToAction: string; hashtags: string[] };

export function readAutopostAnswer(outputText: string): AutopostText | null {
  let json: unknown;
  try {
    json = JSON.parse(outputText);
  } catch {
    return null;
  }
  const parsed = answerSchema.safeParse(json);
  if (!parsed.success) {
    return null;
  }
  const body = cleanReplyText(parsed.data.body);
  if (body === "" || body.length > BODY_MAX_LENGTH) {
    return null;
  }
  const hashtags = parsed.data.hashtags
    .map((tag) => tag.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, ""))
    .filter((tag) => tag.length > 0 && tag.length <= 60)
    .slice(0, HASHTAGS_MAX);
  return { body, callToAction: cutToLength(toPlainSingleLine(parsed.data.call_to_action), 200).trim(), hashtags };
}
