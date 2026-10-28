// Who may do what with the business profile and the interview (step 36),
// the marketing strategy (step 37), the content studio (step 38), the
// social accounts (step 40), the publishing queue and calendar (step 41)
// and the performance reviews (step 42). One place, read by the services
// and by /db (with the role read again, locked, inside the transaction that
// writes), and by the pages only to hide what would be refused anyway.

type Role = "owner" | "member";

// Answering and restarting the interview, confirming, editing and dismissing
// facts, and asking for suggestions from knowledge. The profile decides what
// the AI says about the business, so only owners shape it; members read it.
export function canManageBusinessProfile(role: Role): boolean {
  return role === "owner";
}

// Making a marketing plan, and the setting that lets the plans read support
// trends. A plan speaks for the business, and the setting decides what of
// support reaches the AI, so only owners; members read both.
export function canManageMarketingStrategy(role: Role): boolean {
  return role === "owner";
}

// Approving and rejecting content drafts. An approved draft is what the
// business may publish (step 41), so only owners. Everyone in the company
// writes, edits, regenerates, archives and restores drafts: none of that
// publishes anything, and an edit only ever takes an approval away.
export function canReviewContentDrafts(role: Role): boolean {
  return role === "owner";
}

// Connecting, reconnecting and disconnecting social accounts. A connection
// decides where the business publishes in its own name, so only owners;
// members see which accounts are connected.
export function canManageSocialAccounts(role: Role): boolean {
  return role === "owner";
}

// Scheduling posts, canceling them, publishing one now, retrying one that
// failed, saying what became of one that needs attention, and the
// auto-publish rules. Each decides what the business publishes in its own
// name, and when, so only owners; members see the queue and the calendar.
export function canManagePublishing(role: Role): boolean {
  return role === "owner";
}

// "Plan the next 2 weeks" on the calendar: the AI adds ideas for the whole
// team to work on, a paid call each time, so only owners. An idea publishes
// nothing.
export function canPlanContentCalendar(role: Role): boolean {
  return role === "owner";
}

// "Review performance" on the Analytics page (step 42): a paid call each
// time, and its findings feed the next marketing plans, which only owners
// make; members read the numbers and the newest review.
export function canReviewPerformance(role: Role): boolean {
  return role === "owner";
}
