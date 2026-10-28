import { z } from "zod";
import { PLATFORM_RULES, describeAcceptedFormats } from "@/lib/content-rules";
import { contentFormats } from "@/lib/content-studio/formats";
import { cleanDraftLine, cleanDraftLines, COMBINING_MARKS_MAX_RUN, hasTooManyMarksInARow } from "@/lib/content-studio/draft-text";
import { readTypedHashtags } from "@/lib/content-studio/hashtags";
import {
  DRAFT_BODY_MAX_LENGTH,
  DRAFT_CALL_TO_ACTION_MAX_LENGTH,
  DRAFT_CAMPAIGN_MAX_LENGTH,
  DRAFT_HASHTAGS_MAX,
  DRAFT_IMAGE_PROMPT_MAX_LENGTH,
  DRAFT_PILLAR_MAX_LENGTH,
  DRAFT_TITLE_MAX_LENGTH,
  DRAFT_TOPIC_MAX_LENGTH,
  DRAFT_VIDEO_SCRIPT_MAX_LENGTH,
  REJECTION_NOTE_MAX_LENGTH,
} from "@/lib/content-studio/limits";
import { socialPlatforms } from "@/lib/social-platforms";

// What the content studio's forms send (step 38). There is deliberately no
// company, person, status, approval or claim here: the company and the
// person come from the session, /db sets the status and the version, only
// an owner's own Approve approves, and only the AI's answer (checked by this
// code) lists claims. A draft's id and version are only claims, compared in
// the transaction that writes.

// Tabs and line breaks stay; other control characters can't be typed, and
// Postgres refuses NUL.
const NO_CONTROL_CHARACTERS_BUT_LINE_BREAKS = /^(?:[^\p{Cc}]|[\n\t])*$/u;
const CONTROL_CHARACTERS_MESSAGE = "Remove the invisible control characters from the text.";
const TOO_MANY_MARKS_MESSAGE = `Take out some accents or other marks: at most ${COMBINING_MARKS_MAX_RUN} can follow each other.`;

// One line of a draft (lib/content-studio/draft-text.ts) of at most
// maxLength; missing = "".
function oneLine(maxLength: number, label: string) {
  return z
    .string()
    .nullish()
    .transform((text) => cleanDraftLine(text ?? ""))
    .pipe(
      z
        .string()
        .max(maxLength, `${label} can be at most ${maxLength.toLocaleString("en-US")} characters.`)
        .refine((text) => !hasTooManyMarksInARow(text), TOO_MANY_MARKS_MESSAGE),
    );
}

// Several lines, a line break counting once as in the box (stored as \n),
// at most maxLength; missing = "".
function severalLines(maxLength: number, label: string) {
  return z
    .string()
    .nullish()
    .transform((text) => cleanDraftLines(text ?? ""))
    .pipe(
      z
        .string()
        .max(maxLength, `${label} can be at most ${maxLength.toLocaleString("en-US")} characters.`)
        .regex(NO_CONTROL_CHARACTERS_BUT_LINE_BREAKS, CONTROL_CHARACTERS_MESSAGE)
        .refine((text) => !hasTooManyMarksInARow(text), TOO_MANY_MARKS_MESSAGE),
    );
}

const topicSchema = oneLine(DRAFT_TOPIC_MAX_LENGTH, "A topic").pipe(z.string().min(1, "Say what the post is about."));

// The editor's hashtag box ("#bread #lisbon"): each one word of letters,
// digits or "_", at most DRAFT_HASHTAGS_MAX.
const hashtagsSchema = z
  .string()
  .nullish()
  .transform((text) => (text ?? "").slice(0, 5_000))
  .pipe(z.string().refine((text) => !hasTooManyMarksInARow(text), TOO_MANY_MARKS_MESSAGE))
  .transform(readTypedHashtags)
  .superRefine((typed, context) => {
    if (typed.invalid.length > 0) {
      const message = `Not a hashtag: ${typed.invalid.slice(0, 3).join(" ")}. A hashtag is one word of letters, digits or _.`;
      context.addIssue({ code: "custom", message });
    } else if (typed.hashtags.length > DRAFT_HASHTAGS_MAX) {
      context.addIssue({ code: "custom", message: `A draft can hold at most ${DRAFT_HASHTAGS_MAX} hashtags.` });
    }
  })
  .transform((typed) => typed.hashtags);

// Lowercase, the way Postgres gives ids back.
const draftIdSchema = z.uuid().transform((id) => id.toLowerCase());
// The version the page showed: compared with the stored one when saving.
const versionSchema = z.coerce.number().int().min(1).max(2_147_483_647);

// A ticked checkbox sends "on"; an unticked one sends nothing.
const checkboxSchema = z
  .literal("on")
  .nullish()
  .transform((value) => value === "on");

// "New draft": the platform and a format it takes, the topic, and the
// plan's pillar and campaign by name (optional).
export const newDraftSchema = z
  .object({
    platform: z.enum(socialPlatforms, "Pick a platform."),
    format: z.enum(contentFormats, "Pick a format."),
    topic: topicSchema,
    pillar: oneLine(DRAFT_PILLAR_MAX_LENGTH, "A pillar"),
    campaign: oneLine(DRAFT_CAMPAIGN_MAX_LENGTH, "A campaign"),
  })
  .superRefine((draft, context) => {
    if (!PLATFORM_RULES[draft.platform].formats.includes(draft.format)) {
      context.addIssue({ code: "custom", path: ["format"], message: `This platform takes ${describeAcceptedFormats(draft.platform)}.` });
    }
  });

// The editor: every field it shows, and the version it opened with.
export const editDraftSchema = z.object({
  draftId: draftIdSchema,
  version: versionSchema,
  topic: topicSchema,
  pillar: oneLine(DRAFT_PILLAR_MAX_LENGTH, "A pillar"),
  campaign: oneLine(DRAFT_CAMPAIGN_MAX_LENGTH, "A campaign"),
  title: oneLine(DRAFT_TITLE_MAX_LENGTH, "A title"),
  body: severalLines(DRAFT_BODY_MAX_LENGTH, "The text"),
  hashtags: hashtagsSchema,
  callToAction: oneLine(DRAFT_CALL_TO_ACTION_MAX_LENGTH, "A call to action"),
  imagePrompt: severalLines(DRAFT_IMAGE_PROMPT_MAX_LENGTH, "An image description"),
  videoScript: severalLines(DRAFT_VIDEO_SCRIPT_MAX_LENGTH, "A video script"),
});

// Regenerate: the draft and the version the page showed.
export const draftVersionSchema = z.object({ draftId: draftIdSchema, version: versionSchema });

// Approve: the version the owner read, and "I checked these claims".
export const approveDraftSchema = z.object({ draftId: draftIdSchema, version: versionSchema, claimsChecked: checkboxSchema });

// Reject: the version the owner read, and an optional note (blank = none).
export const rejectDraftSchema = z.object({
  draftId: draftIdSchema,
  version: versionSchema,
  note: severalLines(REJECTION_NOTE_MAX_LENGTH, "A note").transform((note) => (note === "" ? null : note)),
});

// Archive and Restore: the draft only.
export const draftIdOnlySchema = z.object({ draftId: draftIdSchema });
