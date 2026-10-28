import { z } from "zod";
import { cleanDraftLine } from "@/lib/content-studio/draft-text";
import { DRAFT_PILLAR_MAX_LENGTH } from "@/lib/content-studio/limits";
import { POST_URL_MAX_LENGTH, SCHEDULE_ACCOUNTS_MAX } from "@/lib/publishing/limits";
import { isKnownTimeZone } from "@/lib/publishing/schedule-time";
import { socialPlatforms } from "@/lib/social-platforms";
import { NO_CONTROL_CHARACTERS } from "./control-characters";

// What the publishing queue's, the calendar's and a draft's publishing forms
// send (step 41). There is deliberately no company, person, status,
// approval mode, approved version or rule here: the company and the person
// come from the session, and /db decides the rest with the draft's row
// locked. Ids and versions are only claims, compared in the transaction
// that writes.

// Lowercase, the way Postgres gives ids back.
const idSchema = z.uuid().transform((id) => id.toLowerCase());
// The version the page showed: compared with the stored one when scheduling.
const versionSchema = z.coerce.number().int().min(1).max(2_147_483_647);
// A ticked checkbox sends "on"; an unticked one sends nothing.
const checkboxSchema = z
  .literal("on")
  .nullish()
  .transform((value) => value === "on");
// An instant in UTC as the browser made it ("2026-11-03T14:30:00.000Z"); empty = none.
const instantSchema = z
  .string()
  .nullish()
  .transform((text) => (text ? text : null))
  .pipe(z.iso.datetime().nullable());

// Schedule: the draft and the version the page showed, the accounts picked
// (each once), "now" or a time, and whether the owner chose to send it under
// an auto-publish rule, without an approval. scheduledFor is made in the
// browser from the date and time typed, in the viewer's own timezone.
export const scheduleDraftSchema = z
  .object({
    draftId: idSchema,
    version: versionSchema,
    connectionIds: z
      .array(idSchema)
      .min(1, "Pick at least one account.")
      .max(SCHEDULE_ACCOUNTS_MAX)
      .transform((ids) => [...new Set(ids)]),
    when: z.enum(["now", "later"], "Pick when it goes out."),
    scheduledFor: instantSchema,
    withoutApproval: checkboxSchema,
  })
  .refine((input) => input.when === "now" || input.scheduledFor !== null, { path: ["scheduledFor"], message: "Pick a date and a time." });

// Cancel, Publish now, Retry and "Mark as not published": the job only.
export const publishJobIdSchema = z.object({ jobId: idSchema });

// "Mark as published": the job, and the post's address if the owner has it
// (checked against the platform's hosts once the job's platform is known).
export const markPublishedSchema = z.object({
  jobId: idSchema,
  postUrl: z
    .string()
    .nullish()
    .transform((text) => (text ?? "").trim())
    .pipe(z.string().max(POST_URL_MAX_LENGTH, "That address is too long.").regex(NO_CONTROL_CHARACTERS, "That isn't a web address.")),
});

// A new auto-publish rule: a platform, and a content pillar of the current
// plan by name ("" = any pillar). Rules start switched off.
export const newAutopublishRuleSchema = z.object({
  platform: z.enum(socialPlatforms, "Pick a platform."),
  pillar: z
    .string()
    .nullish()
    .transform((text) => cleanDraftLine(text ?? ""))
    .pipe(z.string().max(DRAFT_PILLAR_MAX_LENGTH, `A pillar can be at most ${DRAFT_PILLAR_MAX_LENGTH} characters.`)),
});

// Turning a rule on or off.
export const autopublishRuleIdSchema = z.object({ ruleId: idSchema });

// "Plan the next 2 weeks": the viewer's own timezone, as the browser names
// it, so the plan's days and times are theirs.
export const calendarPlanSchema = z.object({
  timeZone: z
    .string()
    .max(100)
    .refine(isKnownTimeZone, "Your browser didn't say its timezone. Reload the page and try again."),
});
