import { CONTENT_FORMAT_LABELS, CONTENT_FORMAT_PLURALS, type ContentFormat } from "@/lib/content-studio/formats";
import { formatHashtags } from "@/lib/content-studio/hashtags";
import { COUNTING_UNITS, measureText, type CountingMethod } from "@/lib/content-studio/text-measure";
import { findWordsToAvoid } from "@/lib/content-studio/words-to-avoid";
import { SOCIAL_PLATFORM_LABELS, type SocialPlatform } from "@/lib/social-platforms";

// What each social platform takes, and the rules a content draft must meet
// before an owner can approve it (step 38). ONE place: the editor's live
// counts and issues in the browser, the approval in /db, and the AI's
// prompt all read this file, so they agree. Written against the platforms'
// own documentation (docs/research/social-publishing-apis.md). Pure.

export type IssueSeverity = "blocking" | "warning";

export type ContentIssueCode =
  | "format_not_accepted" | "media_missing" | "text_missing" | "text_too_long" | "title_missing"
  | "title_too_long" | "angle_brackets" | "too_many_hashtags" | "many_hashtags" | "word_to_avoid";

// blocking: an owner can't approve until it is fixed. warning: worth a look.
export type ContentIssue = { code: ContentIssueCode; severity: IssueSeverity; message: string };

export type PlatformRules = {
  // The formats it publishes. YouTube's API takes videos only (no text posts).
  formats: readonly ContentFormat[];
  // YouTube: a video's title, required. null: the platform has none.
  title: { max: number } | null;
  // The text it publishes (YouTube: the video's description), its limit,
  // and how the platform counts it (lib/content-studio/text-measure.ts).
  text: { label: string; max: number; counting: CountingMethod };
  // At most `max` hashtags (blocking above); above `recommendedMax` a warning.
  hashtags: { max: number; recommendedMax: number | null };
  // YouTube refuses "<" and ">" in a title or a description.
  refusesAngleBrackets: boolean;
  // Where its feed cuts a long text behind "see more": about this many
  // characters or lines, whichever comes first. Apps differ by screen and
  // change over time, so the preview only shows roughly where. null: never.
  feedCut: { characters: number; lines: number; moreLabel: string } | null;
};

const EVERY_FORMAT: readonly ContentFormat[] = ["post", "image_post", "video"];

export const PLATFORM_RULES: Record<SocialPlatform, PlatformRules> = {
  linkedin: {
    formats: EVERY_FORMAT,
    title: null,
    text: { label: "Post text", max: 3_000, counting: "characters" },
    hashtags: { max: 10, recommendedMax: null },
    refusesAngleBrackets: false,
    feedCut: { characters: 210, lines: 3, moreLabel: "...see more" },
  },
  facebook: {
    formats: EVERY_FORMAT,
    title: null,
    text: { label: "Post text", max: 63_206, counting: "characters" },
    hashtags: { max: 10, recommendedMax: null },
    refusesAngleBrackets: false,
    feedCut: { characters: 480, lines: 5, moreLabel: "See more" },
  },
  x: {
    formats: EVERY_FORMAT,
    title: null,
    text: { label: "Post text", max: 280, counting: "x" },
    hashtags: { max: 10, recommendedMax: 2 },
    refusesAngleBrackets: false,
    feedCut: null,
  },
  youtube: {
    formats: ["video"],
    title: { max: 100 },
    text: { label: "Description", max: 5_000, counting: "utf8-bytes" },
    hashtags: { max: 10, recommendedMax: null },
    refusesAngleBrackets: true,
    feedCut: { characters: 160, lines: 3, moreLabel: "...more" },
  },
};

// The fields of a draft the rules read.
export type DraftContent = {
  platform: SocialPlatform;
  format: ContentFormat;
  title: string;
  body: string;
  hashtags: readonly string[];
  callToAction: string;
  videoScript: string;
};

// The image or video attached to a draft from the media library (step 39):
// its kind, and its alt text, which is published with it.
export type AttachedMedia = { kind: "image" | "video"; altText: string };

export type RuleContext = {
  // null: nothing attached.
  media: AttachedMedia | null;
  // From the confirmed "Words to avoid" fact (lib/content-studio/words-to-avoid.ts).
  wordsToAvoid: readonly string[];
};

// The text a platform publishes: the body, then the call to action, then
// the hashtags, each as its own paragraph. On YouTube it is the video's
// description. The preview shows exactly this, and the limits count it.
export function composePublishedText(draft: Pick<DraftContent, "body" | "callToAction" | "hashtags">): string {
  return [draft.body.trim(), draft.callToAction.trim(), formatHashtags(draft.hashtags)].filter(Boolean).join("\n\n");
}

// Every problem with a draft, in the order a person fixes them: what it
// is, what it says, then the words it uses.
export function checkContentRules(draft: DraftContent, context: RuleContext): ContentIssue[] {
  const rules = PLATFORM_RULES[draft.platform];
  return [
    ...formatIssues(draft, rules, context.media),
    ...titleIssues(draft, rules),
    ...textIssues(draft, rules),
    ...hashtagIssues(draft, rules),
    ...wordsToAvoidIssues(draft, rules, context),
  ];
}

// "text posts, posts with an image and videos", or "videos only".
export function describeAcceptedFormats(platform: SocialPlatform): string {
  const names = PLATFORM_RULES[platform].formats.map((format) => CONTENT_FORMAT_PLURALS[format]);
  return names.length === 1 ? `${names[0]} only` : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function formatIssues(draft: DraftContent, rules: PlatformRules, media: RuleContext["media"]): ContentIssue[] {
  const platform = SOCIAL_PLATFORM_LABELS[draft.platform];
  if (!rules.formats.includes(draft.format)) {
    const message = `${platform} takes ${describeAcceptedFormats(draft.platform)}, not a ${CONTENT_FORMAT_LABELS[draft.format].toLowerCase()}.`;
    return [{ code: "format_not_accepted", severity: "blocking", message }];
  }
  const needed = draft.format === "video" ? "video" : draft.format === "image_post" ? "image" : null;
  if (needed && media?.kind !== needed) {
    const what = needed === "video" ? "This video needs its video" : "This post needs its image";
    const how = needed === "video" ? "attach one from the media library" : "attach one from the media library, or make one with the AI";
    const message = `${what} before it can be approved: ${how} (under Media).`;
    return [{ code: "media_missing", severity: "blocking", message }];
  }
  return [];
}

function titleIssues(draft: DraftContent, rules: PlatformRules): ContentIssue[] {
  if (!rules.title) {
    return [];
  }
  const platform = SOCIAL_PLATFORM_LABELS[draft.platform];
  const length = measureText(draft.title.trim(), "characters");
  if (length === 0) {
    return [{ code: "title_missing", severity: "blocking", message: `A ${platform} video needs a title.` }];
  }
  if (length > rules.title.max) {
    const message = `The title is ${length.toLocaleString("en-US")} characters. ${platform} allows ${rules.title.max}.`;
    return [{ code: "title_too_long", severity: "blocking", message }];
  }
  return [];
}

function textIssues(draft: DraftContent, rules: PlatformRules): ContentIssue[] {
  const platform = SOCIAL_PLATFORM_LABELS[draft.platform];
  const text = composePublishedText(draft);
  const issues: ContentIssue[] = [];
  if (draft.format === "post" && !draft.body.trim()) {
    issues.push({ code: "text_missing", severity: "blocking", message: "The post has no text yet." });
  }
  const length = measureText(text, rules.text.counting);
  if (length > rules.text.max) {
    const what = rules.title ? "The description" : "The post";
    const counted = `${length.toLocaleString("en-US")} ${COUNTING_UNITS[rules.text.counting]}`;
    const bytesNote = rules.text.counting === "utf8-bytes" ? " (an accented letter counts 2, an emoji 4)" : "";
    const message = `${what} is ${counted}, call to action and hashtags included. ${platform} allows ${rules.text.max.toLocaleString("en-US")}${bytesNote}.`;
    issues.push({ code: "text_too_long", severity: "blocking", message });
  }
  if (rules.refusesAngleBrackets && /[<>]/.test(`${draft.title}${text}`)) {
    const message = `${platform} refuses "<" and ">" in a title or description. Take them out.`;
    issues.push({ code: "angle_brackets", severity: "blocking", message });
  }
  return issues;
}

function hashtagIssues(draft: DraftContent, rules: PlatformRules): ContentIssue[] {
  const count = draft.hashtags.length;
  const platform = SOCIAL_PLATFORM_LABELS[draft.platform];
  if (count > rules.hashtags.max) {
    return [{ code: "too_many_hashtags", severity: "blocking", message: `${count} hashtags. ${platform} posts take at most ${rules.hashtags.max}.` }];
  }
  const recommended = rules.hashtags.recommendedMax;
  if (recommended !== null && count > recommended) {
    return [{ code: "many_hashtags", severity: "warning", message: `${count} hashtags. ${platform} recommends no more than ${recommended}.` }];
  }
  return [];
}

// One issue per word to avoid that the draft uses, saying where: its texts,
// and the alt text of its image or video (published with it). WHY each text
// is searched once for all the words: a search normalizes the text first,
// and a long text normalized once per word took seconds.
function wordsToAvoidIssues(draft: DraftContent, rules: PlatformRules, context: RuleContext): ContentIssue[] {
  const { media, wordsToAvoid } = context;
  const places: [string, string[]][] = [
    ["the title", findWordsToAvoid(draft.title, wordsToAvoid)],
    [`the ${rules.text.label.toLowerCase()}`, findWordsToAvoid(composePublishedText(draft), wordsToAvoid)],
    ["the video script", findWordsToAvoid(draft.videoScript, wordsToAvoid)],
  ];
  if (media) {
    places.push([`the ${media.kind}'s alt text (media library)`, findWordsToAvoid(media.altText, wordsToAvoid)]);
  }
  return wordsToAvoid.flatMap((word): ContentIssue[] => {
    const where = places.filter(([, found]) => found.includes(word)).map(([place]) => place);
    if (where.length === 0) {
      return [];
    }
    const message = `"${word}" is on your Words to avoid list (business profile), and this draft uses it in ${where.join(" and ")}.`;
    return [{ code: "word_to_avoid", severity: "blocking", message }];
  });
}
