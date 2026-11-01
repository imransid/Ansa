// What became of one planned post (step 54): being written, scheduled in
// the publishing queue, waiting for an owner's approval ("Ask me first"),
// or skipped, with why. Pure: the table's CHECKs and the page share them.

export const AUTOPOST_SLOT_STATUSES = ["writing", "scheduled", "waiting_approval", "skipped"] as const;
export type AutopostSlotStatus = (typeof AUTOPOST_SLOT_STATUSES)[number];

export const SKIP_REASONS = ["no_page", "no_ai", "ai_failed", "checks_failed", "not_owner", "stopped"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export const SKIP_REASON_TEXT: Record<SkipReason, string> = {
  no_page: "No Facebook Page was connected.",
  no_ai: "No AI is set up (Settings → Assistant).",
  ai_failed: "The AI didn't answer in time.",
  checks_failed: "ansa's checks stopped the text twice (a price, an offer or a link it couldn't confirm).",
  not_owner: "The owner who switched it on is no longer an owner: an owner switches it on again.",
  stopped: "Posting was switched off.",
};
