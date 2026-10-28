// The limits of the business profile and the interview (step 36). Its own
// small file so the forms in the browser use the same numbers as the
// server's Zod schemas (lib/validation/cofounder.ts) and the database's
// CHECKs (db/schema/business-facts.ts).

// One fact, confirmed or proposed. A line break counts once, as in the box.
export const BUSINESS_FACT_MAX_LENGTH = 2_000;
// One answer the owner types into the interview.
export const INTERVIEW_ANSWER_MAX_LENGTH = 4_000;
// One question the Co-Founder asks (Claude's is cut to this).
export const INTERVIEW_QUESTION_MAX_LENGTH = 500;
// How many of the newest messages the interview page shows.
export const INTERVIEW_MESSAGES_SHOWN = 100;
// How many of the newest messages Claude reads each turn: enough to follow
// the conversation, without sending the whole interview every time.
export const INTERVIEW_MESSAGES_FOR_AI = 12;
// How much of each fact's value Claude reads: enough to know what is there.
export const FACT_CHARACTERS_FOR_AI = 300;
// How much of an older message Claude reads. The owner's newest answer is
// always read whole (INTERVIEW_ANSWER_MAX_LENGTH).
export const OLDER_MESSAGE_CHARACTERS_FOR_AI = 1_000;
// How much of a knowledge article "Suggest facts from knowledge" reads: its
// first pieces, whole, within this many characters, tags included.
export const ARTICLE_CHARACTERS_FOR_SUGGESTIONS = 10_000;
