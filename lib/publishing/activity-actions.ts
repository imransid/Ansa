// What the Co-Founder's activity log (step 41, cofounder_activity) records:
// who did what to the accounts, drafts, publish jobs, auto-publish rules and
// marketing plans. A file of its own with no imports, so the pages and the
// database schema (db/schema/cofounder-activity.ts, whose CHECK lists the
// same values; a check proves they agree) read one list. Each row is written
// by the /db function that makes the change, in the same transaction.
export const cofounderActivityActions = [
  // Social accounts (step 40): an owner connected or disconnected one, or a
  // platform refused its permission (the app noted it: no actor).
  "connected",
  "disconnected",
  "reconnect_needed",
  // Drafts (step 38).
  "draft_approved",
  "draft_rejected",
  // A change of content took an approval away (and canceled its scheduled posts).
  "draft_changed_after_approval",
  "draft_archived",
  "draft_restored",
  // "Plan the next 2 weeks" made an idea on the calendar.
  "idea_planned",
  // Publish jobs.
  "scheduled",
  "canceled",
  "publish_now",
  "published",
  "publish_failed",
  // The platform asked to wait (or the company's daily limit was reached):
  // tried again later by itself.
  "publish_delayed",
  "needs_attention",
  "marked_published",
  "marked_not_published",
  "retried",
  // Auto-publish rules.
  "rule_created",
  "rule_enabled",
  "rule_disabled",
  // Marketing plans (step 37).
  "plan_created",
] as const;
export type CofounderActivityAction = (typeof cofounderActivityActions)[number];
