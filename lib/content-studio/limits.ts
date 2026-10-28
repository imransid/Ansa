// The limits of the Co-Founder's content drafts (step 38). Its own small
// file so the forms in the browser, the server's Zod schemas
// (lib/validation/content-drafts.ts), the AI's answer (draft-answer.ts) and
// the database's CHECKs (db/schema/content-drafts.ts) use the same numbers.
// What each PLATFORM allows is a different thing: lib/content-rules.ts.

// What a draft is about, and the plan's pillar and campaign it belongs to.
export const DRAFT_TOPIC_MAX_LENGTH = 500;
export const DRAFT_PILLAR_MAX_LENGTH = 200;
export const DRAFT_CAMPAIGN_MAX_LENGTH = 200;

// The content itself. The body holds up to Facebook's limit, the longest of
// the four platforms; each platform's own limit is a rule, not a refusal,
// so a draft that is too long for X is still saved and shown as such.
export const DRAFT_TITLE_MAX_LENGTH = 100;
export const DRAFT_BODY_MAX_LENGTH = 63_206;
export const DRAFT_CALL_TO_ACTION_MAX_LENGTH = 300;
export const DRAFT_IMAGE_PROMPT_MAX_LENGTH = 2_000;
export const DRAFT_VIDEO_SCRIPT_MAX_LENGTH = 10_000;

// Hashtags a draft can hold. Platforms take at most 10 (a rule that blocks
// approval), but a draft may hold more while someone trims them.
export const DRAFT_HASHTAGS_MAX = 30;
export const HASHTAG_MAX_LENGTH = 60;

// An owner's note when rejecting a draft.
export const REJECTION_NOTE_MAX_LENGTH = 500;

// The factual claims the AI lists for one draft, and the length of each.
// A longer list makes the AI's answer unusable rather than cut: a claim
// left out would be a claim nobody checks.
export const DRAFT_CLAIMS_MAX = 30;
export const CLAIM_TEXT_MAX_LENGTH = 500;

// How much approved marketing knowledge one draft reads: whole pieces, best
// first, tags included (lib/knowledge/prompt-slice.ts).
export const DRAFT_KNOWLEDGE_CHARACTERS = 4_000;
// How many hits the search is asked for: all it gives (10).
export const DRAFT_KNOWLEDGE_HITS = 10;

// The "Words to avoid" fact becomes at most this many words and phrases,
// each 2-100 characters (lib/content-studio/words-to-avoid.ts).
export const WORDS_TO_AVOID_MAX = 100;
export const WORD_TO_AVOID_MAX_LENGTH = 100;

// The largest stored claims list, as JSON text: far above 30 claims of 500
// characters, a safety net under the schema.
export const DRAFT_CLAIMS_JSON_MAX_LENGTH = 50_000;
