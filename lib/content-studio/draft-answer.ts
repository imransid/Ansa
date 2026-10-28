import { z } from "zod";
import { cutToLength } from "@/lib/cofounder/fact-proposals";
import type { ModelResult } from "@/lib/model-request";
import { toPlainSingleLine } from "@/lib/plain-text";
import type { SocialPlatform } from "@/lib/social-platforms";
import { markClaims, type StoredClaim } from "./claims";
import { keepUsedFields, type ContentFields } from "./draft-fields";
import { cleanDraftLine, cutRunsOfMarks } from "./draft-text";
import type { ContentFormat } from "./formats";
import { cleanModelHashtags } from "./hashtags";
import {
  CLAIM_TEXT_MAX_LENGTH,
  DRAFT_BODY_MAX_LENGTH,
  DRAFT_CALL_TO_ACTION_MAX_LENGTH,
  DRAFT_CLAIMS_MAX,
  DRAFT_IMAGE_PROMPT_MAX_LENGTH,
  DRAFT_TITLE_MAX_LENGTH,
  DRAFT_VIDEO_SCRIPT_MAX_LENGTH,
} from "./limits";

// Reading Claude's answer for one content draft (step 38), written twice
// like every other use: the JSON schema the API enforces
// (draft-json-schema.ts) and this Zod schema. Strict: a field we didn't ask
// for (a claim's "supported", a company or a draft id) makes the whole
// answer unusable, so Claude can't decide what its claims are worth or what
// its answer belongs to. Texts are cleaned and cut to what a draft can hold,
// never refused for their length; a platform's own limit (X's 280) is a rule
// shown on the page (lib/content-rules.ts), not a cut. More than
// DRAFT_CLAIMS_MAX claims is unusable: a claim left out is one nobody checks.

const claimSchema = z.object({ text: z.string(), fact_topics: z.array(z.string()) }).strict();

export const contentDraftAnswerSchema = z
  .object({
    title: z.string(),
    body: z.string(),
    hashtags: z.array(z.string()),
    call_to_action: z.string(),
    image_prompt: z.string(),
    video_script: z.string(),
    claims: z.array(claimSchema).max(DRAFT_CLAIMS_MAX),
  })
  .strict();

export type GeneratedContent = ContentFields & { claims: StoredClaim[] };

// Claude's answer as content that may be saved, or null when there is none
// to save: not asked (no API key), refused, cut off, failed, not JSON,
// another shape, or without its main text (a post's body, a YouTube video's
// title). sentTopics: the topics of the confirmed facts the request held.
export function readContentDraftAnswer(
  result: ModelResult,
  request: { platform: SocialPlatform; format: ContentFormat },
  sentTopics: ReadonlySet<string>,
): GeneratedContent | null {
  if (result.kind !== "ok") {
    return null;
  }
  const parsed = contentDraftAnswerSchema.safeParse(parseJsonOrNull(result.outputText));
  if (!parsed.success) {
    return null;
  }
  const answer = parsed.data;
  const fields = keepUsedFields(request.platform, request.format, {
    title: cleanModelLine(answer.title, DRAFT_TITLE_MAX_LENGTH),
    body: cleanMultilineText(answer.body, DRAFT_BODY_MAX_LENGTH),
    hashtags: cleanModelHashtags(answer.hashtags),
    callToAction: cleanModelLine(answer.call_to_action, DRAFT_CALL_TO_ACTION_MAX_LENGTH),
    imagePrompt: cleanMultilineText(answer.image_prompt, DRAFT_IMAGE_PROMPT_MAX_LENGTH),
    videoScript: cleanMultilineText(answer.video_script, DRAFT_VIDEO_SCRIPT_MAX_LENGTH),
  });
  const mainText = request.platform === "youtube" ? fields.title : fields.body;
  if (!mainText) {
    return null;
  }
  const claims = answer.claims
    .map((claim) => ({ text: cutToLength(toPlainSingleLine(claim.text), CLAIM_TEXT_MAX_LENGTH), fact_topics: claim.fact_topics }))
    .filter((claim) => claim.text !== "");
  return { ...fields, claims: markClaims(claims, sentTopics) };
}

// Text of several lines as a draft holds it: line breaks as \n, no control
// characters but line breaks and tabs (Postgres refuses NUL), at most one
// blank line in a row, no spaces at the ends, no more marks in a row than
// a person may type (draft-text.ts), at most maxLength.
export function cleanMultilineText(text: string, maxLength: number): string {
  const tidy = text
    .replace(/\r\n?/g, "\n")
    .replace(/\p{Cc}/gu, (character) => (character === "\n" || character === "\t" ? character : ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cutToLength(cutRunsOfMarks(tidy), maxLength);
}

// One line as a draft holds it (draft-text.ts), with no more marks in a row
// than a person may type, at most maxLength.
function cleanModelLine(text: string, maxLength: number): string {
  return cutToLength(cutRunsOfMarks(cleanDraftLine(text)), maxLength);
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
