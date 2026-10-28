import { z } from "zod";
import { cleanDraftLine, cleanDraftLines, COMBINING_MARKS_MAX_RUN, hasTooManyMarksInARow } from "@/lib/content-studio/draft-text";
import { mediaKinds } from "@/lib/media/kinds";
import { GENERATION_PROMPT_MAX_LENGTH, MEDIA_ALT_TEXT_MAX_LENGTH } from "@/lib/media/limits";

// What the media library's forms send (step 39). There is deliberately no
// company, person, source, provider, status or storage key here: the
// company and the person come from the session, the type from the file's
// own bytes, the key from ids, and the status from the claim. Ids are only
// claims, compared within the company in the transaction that writes.

// Tabs and line breaks stay; other control characters can't be typed, and
// Postgres refuses NUL.
const NO_CONTROL_CHARACTERS_BUT_LINE_BREAKS = /^(?:[^\p{Cc}]|[\n\t])*$/u;

// Lowercase, the way Postgres gives ids back.
const idSchema = z.uuid().transform((id) => id.toLowerCase());
const versionSchema = z.coerce.number().int().min(1).max(2_147_483_647);

// What a picture shows: one plain line (line breaks become spaces), as it
// is published with the image (step 41); missing = "".
export const altTextSchema = z
  .string()
  .nullish()
  .transform((text) => cleanDraftLine(text ?? ""))
  .pipe(z.string().max(MEDIA_ALT_TEXT_MAX_LENGTH, `A description can be at most ${MEDIA_ALT_TEXT_MAX_LENGTH.toLocaleString("en-US")} characters.`));

// The library's alt text box, and its asset.
export const mediaAltTextSchema = z.object({ assetId: idSchema, altText: altTextSchema });

// One asset (serving, deleting).
export const mediaAssetIdSchema = z.object({ assetId: idSchema });

// One request (canceling, "Start now").
export const generationJobIdSchema = z.object({ jobId: idSchema });

// "Generate an image": the kind and the prompt, a line break counting once
// as in the box (stored as \n), at most 2,000 characters.
export const generationRequestSchema = z.object({
  kind: z.enum(mediaKinds, "Pick an image or a video."),
  prompt: z
    .string()
    .nullish()
    .transform((text) => cleanDraftLines(text ?? ""))
    .pipe(
      z
        .string()
        .min(1, "Say what the picture should show.")
        .max(GENERATION_PROMPT_MAX_LENGTH, `A prompt can be at most ${GENERATION_PROMPT_MAX_LENGTH.toLocaleString("en-US")} characters.`)
        .regex(NO_CONTROL_CHARACTERS_BUT_LINE_BREAKS, "Remove the invisible control characters from the text.")
        .refine((text) => !hasTooManyMarksInARow(text), `Take out some accents or other marks: at most ${COMBINING_MARKS_MAX_RUN} can follow each other.`),
    ),
});

// A draft's media (attach one, or "" to take it off), at the version the page showed.
export const draftMediaSchema = z.object({
  draftId: idSchema,
  version: versionSchema,
  assetId: z.union([idSchema, z.literal("").transform(() => null)]),
});

// "Make the image with the AI" on a draft: from its saved image description, at the version the page showed.
export const draftGenerationSchema = z.object({ draftId: idSchema, version: versionSchema });
