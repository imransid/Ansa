import { z } from "zod";
import { businessFactTopics } from "@/lib/business-facts";
import { BUSINESS_FACT_MAX_LENGTH, INTERVIEW_ANSWER_MAX_LENGTH } from "@/lib/cofounder/limits";
import { multilineText } from "./ticket-fields";

// What the Co-Founder's forms send (step 36). There is deliberately no
// company, person, source or time here: the company and the person come
// from the session, and the source and times are set by /db.

// Tabs and line breaks stay; other control characters can't be typed, and
// Postgres refuses NUL.
const NO_CONTROL_CHARACTERS_BUT_LINE_BREAKS = /^(?:[^\p{Cc}]|[\n\t])*$/u;

const topicSchema = z.enum(businessFactTopics, "Unknown topic.");

// An answer to the interview. Line breaks count once, as in the box, and are
// stored as \n. openingTopic: sent only while the page shows the interview's
// first question (not saved yet), naming the topic it asked about ("none":
// it asked for anything to add). It is saved as that same question, so the
// conversation keeps the words the owner answered.
export const interviewAnswerSchema = z.object({
  answer: multilineText().pipe(
    z
      .string()
      .trim()
      .min(1, "Type your answer first.")
      .max(INTERVIEW_ANSWER_MAX_LENGTH, `An answer can be at most ${INTERVIEW_ANSWER_MAX_LENGTH.toLocaleString("en-US")} characters.`)
      .regex(NO_CONTROL_CHARACTERS_BUT_LINE_BREAKS, "Remove the invisible control characters from the text."),
  ),
  openingTopic: z.union([topicSchema, z.literal("none")]).optional(),
});

// A fact an owner types (Edit, or Edit and confirm).
const factValueSchema = multilineText().pipe(
  z
    .string()
    .trim()
    .min(1, "Write the fact first.")
    .max(BUSINESS_FACT_MAX_LENGTH, `A fact can be at most ${BUSINESS_FACT_MAX_LENGTH.toLocaleString("en-US")} characters.`)
    .regex(NO_CONTROL_CHARACTERS_BUT_LINE_BREAKS, "Remove the invisible control characters from the text."),
);

// A value the page showed and sends back, only a claim: /db compares it with
// the stored one, and a difference means someone changed it meanwhile.
// Browsers send its line breaks as \r\n; stored values have \n.
const shownValueSchema = multilineText().pipe(z.string().max(BUSINESS_FACT_MAX_LENGTH));

// The confirmed value the page showed ("" = none, which /db reads as null).
const shownConfirmedValueSchema = shownValueSchema.transform((value) => (value === "" ? null : value));

// Confirm (value missing: the proposal as shown) or Edit and confirm (value:
// what the owner typed instead). shownConfirmedValue: the fact beside the
// proposal, so a value another owner saved meanwhile is never replaced unseen.
export const confirmFactSchema = z.object({
  topic: topicSchema,
  shownProposal: shownValueSchema.pipe(z.string().min(1)),
  shownConfirmedValue: shownConfirmedValueSchema,
  value: factValueSchema.optional(),
});

export const dismissProposalSchema = z.object({
  topic: topicSchema,
  shownProposal: shownValueSchema.pipe(z.string().min(1)),
});

// Edit: the new value, and the confirmed value the editor opened with ("" =
// none), so a change someone saved meanwhile is never overwritten unseen.
export const editFactSchema = z.object({
  topic: topicSchema,
  value: factValueSchema,
  originalValue: shownConfirmedValueSchema,
});

// "Suggest facts from knowledge": the article picked. Lowercase, the way
// Postgres gives ids back.
export const factSuggestionSchema = z.object({
  articleId: z.uuid("Pick an article first.").transform((id) => id.toLowerCase()),
});
