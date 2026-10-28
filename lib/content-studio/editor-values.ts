import type { DraftContent } from "@/lib/content-rules";
import type { SocialPlatform } from "@/lib/social-platforms";
import type { ContentFields } from "./draft-fields";
import { cleanDraftLine, cleanDraftLines } from "./draft-text";
import type { ContentFormat } from "./formats";
import { formatHashtags, readTypedHashtags } from "./hashtags";

// What the draft editor holds while someone types (step 38): every box as
// text, the hashtags as typed ("#bread #lisbon"). Pure: the editor uses it,
// and the checks compare it with what the server saves.
export type EditorValues = {
  topic: string;
  pillar: string;
  campaign: string;
  title: string;
  body: string;
  hashtags: string;
  callToAction: string;
  imagePrompt: string;
  videoScript: string;
};

// The boxes of one line, and of several lines, as draft-text.ts cleans them.
const LINE_BOXES = ["topic", "pillar", "campaign", "title", "callToAction"] as const;
const TEXT_BOXES = ["body", "imagePrompt", "videoScript"] as const;

// The editor's boxes for a saved draft.
export function editorValuesOf(draft: { topic: string; pillar: string; campaign: string; fields: ContentFields }): EditorValues {
  return {
    topic: draft.topic,
    pillar: draft.pillar,
    campaign: draft.campaign,
    title: draft.fields.title,
    body: draft.fields.body,
    hashtags: formatHashtags(draft.fields.hashtags),
    callToAction: draft.fields.callToAction,
    imagePrompt: draft.fields.imagePrompt,
    videoScript: draft.fields.videoScript,
  };
}

// True when saving what is typed would store what the editor opened with:
// each box compared as the server saves it, so a space or a line break at
// the ends, two spaces inside a line, or the same hashtags written another
// way ("#a,#b") are no change. WHY: the server saves such an edit as
// "unchanged" (no new version), and an editor still counting it as unsaved
// would keep Approve and Reject waiting for a save that never comes. A
// hashtag the server refuses is always a change, so Save says why.
export function sameEditorValues(typed: EditorValues, opened: EditorValues): boolean {
  const sameLines = LINE_BOXES.every((box) => cleanDraftLine(typed[box]) === cleanDraftLine(opened[box]));
  const sameTexts = TEXT_BOXES.every((box) => cleanDraftLines(typed[box]) === cleanDraftLines(opened[box]));
  return sameLines && sameTexts && sameHashtags(typed.hashtags, opened.hashtags);
}

// What the rules and the preview read: the boxes as they are now, the
// hashtags read the way the server will read them.
export function contentOfEditor(platform: SocialPlatform, format: ContentFormat, values: EditorValues): DraftContent {
  return {
    platform,
    format,
    title: values.title,
    body: values.body,
    hashtags: readTypedHashtags(values.hashtags).hashtags,
    callToAction: values.callToAction,
    videoScript: values.videoScript,
  };
}

// The same hashtags in the same order and spelling, as the server reads
// them (db/content-draft-writes.ts compares them so).
function sameHashtags(typed: string, opened: string): boolean {
  const read = readTypedHashtags(typed);
  return read.invalid.length === 0 && read.hashtags.join("\n") === readTypedHashtags(opened).hashtags.join("\n");
}
