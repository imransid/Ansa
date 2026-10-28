import type { MediaKind } from "@/lib/media/kinds";
import type { SocialPlatform } from "@/lib/social-platforms";
import type { ContentDraftStatus, ContentFormat } from "./formats";

// The content of a draft (step 38), and the rules about it that /db, the
// services and the pages share. Pure.

// What a person or the AI writes. Saving any change to these makes a new
// version (db/content-draft-writes.ts).
export type ContentFields = {
  title: string;
  body: string;
  hashtags: string[];
  callToAction: string;
  imagePrompt: string;
  videoScript: string;
};

// What each change of status may start from. A scheduled draft (step 41)
// can still be changed, rejected or archived: its waiting posts are
// canceled in the same transaction (db/publish-draft-sync.ts). A failed one
// (a post didn't go out) can be changed, approved (when it has no approval
// of this version), rejected or archived. A published one stays as it went
// out: a new post is a new draft.
export const EDITABLE_STATUSES: readonly ContentDraftStatus[] = ["idea", "draft", "approved", "rejected", "scheduled", "failed"];
export const APPROVABLE_STATUSES: readonly ContentDraftStatus[] = ["draft", "rejected", "failed"];
export const REJECTABLE_STATUSES: readonly ContentDraftStatus[] = ["draft", "approved", "scheduled", "failed"];
export const ARCHIVABLE_STATUSES: readonly ContentDraftStatus[] = ["idea", "draft", "approved", "rejected", "scheduled", "failed"];
// The drafts whose image or video can't be deleted from the media library
// (step 39): approved with it, scheduled or published with it, or failed to
// publish (the publishing queue, step 41, can try that again).
export const STATUSES_KEEPING_MEDIA: readonly ContentDraftStatus[] = ["approved", "scheduled", "published", "failed"];
// The drafts whose image's or video's alt text can't change (step 39): it is
// published with them, and these are on their way out or out already (step
// 41). An approved draft only loses its approval, as an edit makes it.
export const STATUSES_KEEPING_ALT_TEXT: readonly ContentDraftStatus[] = ["scheduled", "published", "failed"];

// The fields a platform and format use, the others emptied: only YouTube
// has a title, only a video a script, and a text post no image prompt. The
// database's CHECKs refuse anything else, so every write goes through this.
export function keepUsedFields(platform: SocialPlatform, format: ContentFormat, fields: ContentFields): ContentFields {
  return {
    title: platform === "youtube" ? fields.title : "",
    body: fields.body,
    hashtags: fields.hashtags,
    callToAction: fields.callToAction,
    imagePrompt: format === "post" ? "" : fields.imagePrompt,
    videoScript: format === "video" ? fields.videoScript : "",
  };
}

// True when anything has been written: then the draft is a draft, not an idea.
export function hasContent(fields: ContentFields): boolean {
  const texts = [fields.title, fields.body, fields.callToAction, fields.imagePrompt, fields.videoScript];
  return texts.some((text) => text.trim() !== "") || fields.hashtags.length > 0;
}

// The status after its content changed: a draft again (any approval or
// rejection is over), or an idea when everything was cleared and no image
// or video is attached (step 39). hasMedia: the draft's media_asset_id is set.
export function statusAfterContentChange(fields: ContentFields, hasMedia: boolean): "draft" | "idea" {
  return hasContent(fields) || hasMedia ? "draft" : "idea";
}

// What a format attaches from the media library (step 39): a post with an
// image its image, a video its video, a text post nothing.
export function mediaKindOfFormat(format: ContentFormat): MediaKind | null {
  if (format === "image_post") {
    return "image";
  }
  return format === "video" ? "video" : null;
}

// True when the content is not exactly what the AI last wrote: someone
// typed it, or changed what the AI wrote. Regenerating then asks first. A
// change of the image or video alone carries generated_version along with
// the version (db/content-draft-media.ts): the text is still the AI's.
export function wasEditedByHand(draft: { version: number; generatedVersion: number | null } & ContentFields): boolean {
  return draft.generatedVersion !== draft.version && hasContent(draft);
}
