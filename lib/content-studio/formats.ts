// What a content draft is (step 38): its format and its status, with the
// words the pages use. A file of its own with no imports, so the forms in
// the browser and the database schema (db/schema/content-drafts.ts, whose
// CHECKs list the same keys; a check proves they agree) read one list.

// A text post, a post with an image, or a video (with its script). Which
// platform takes which: PLATFORM_RULES in lib/content-rules.ts.
export const contentFormats = ["post", "image_post", "video"] as const;
export type ContentFormat = (typeof contentFormats)[number];

export const CONTENT_FORMAT_LABELS: Record<ContentFormat, string> = {
  post: "Text post",
  image_post: "Post with an image",
  video: "Video",
};

// "YouTube takes videos only", "X takes text posts, posts with an image and videos".
export const CONTENT_FORMAT_PLURALS: Record<ContentFormat, string> = {
  post: "text posts",
  image_post: "posts with an image",
  video: "videos",
};

// Every status a draft can have: idea (a topic, no content yet), draft,
// approved, rejected and archived (step 38); and while the publishing queue
// (step 41) has it, scheduled (a post on its way), published (every post
// out) and failed (a post didn't go out, or may not have: a person looks;
// lib/publishing/draft-status.ts).
export const contentDraftStatuses = ["idea", "draft", "approved", "rejected", "scheduled", "published", "failed", "archived"] as const;
export type ContentDraftStatus = (typeof contentDraftStatuses)[number];

export const CONTENT_STATUS_LABELS: Record<ContentDraftStatus, string> = {
  idea: "Idea",
  draft: "Draft",
  approved: "Approved",
  rejected: "Rejected",
  scheduled: "Scheduled",
  published: "Published",
  failed: "Publishing problem",
  archived: "Archived",
};
