// The numbers of the Co-Founder's performance reviews (step 42), in one
// small file the page in the browser, the services, the prompt and the
// answer's check share.

// A review needs at least this many posts with numbers in its period:
// fewer say nothing a person couldn't see at a glance, and Claude isn't asked.
export const MIN_POSTS_FOR_REVIEW = 5;

// The most posts one review reads (the newest of the period).
export const REVIEW_POSTS_MAX = 100;

// The most characters of one post's topic the request holds.
export const REVIEW_TOPIC_CHARACTERS = 200;

// The most entries of each list a saved review keeps (Claude is told them).
export const REVIEW_LIST_LIMITS = {
  findings: 8,
  evidencePerFinding: 6,
  recommendations: 6,
  limits: 5,
} as const;

// One finding or recommendation, and one limit of the data.
export const REVIEW_TEXT_MAX_LENGTH = 500;
export const REVIEW_LIMIT_TEXT_MAX_LENGTH = 300;
