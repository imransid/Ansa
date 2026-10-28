import { z } from "zod";
import { GOAL_NOTE_MAX_LENGTH } from "@/lib/marketing-plan/limits";

// What the Strategy page's forms and links send (step 37). There is
// deliberately no company, person, version or fact here: the company and
// the person come from the session, /db numbers each new version, and the
// facts are read from the profile.

// Tabs and line breaks stay; other control characters can't be typed, and
// Postgres refuses NUL.
const NO_CONTROL_CHARACTERS_BUT_LINE_BREAKS = /^(?:[^\p{Cc}]|[\n\t])*$/u;

// "Make a new plan": what the owner asks it to focus on, up to 1,000
// characters with a line break counting once, as in the box (stored as \n).
// Blank or missing = no note (null).
export const marketingPlanRequestSchema = z.object({
  goalNote: z
    .string()
    .nullish()
    .transform((text) => (text ?? "").replace(/\r\n?/g, "\n"))
    .pipe(
      z
        .string()
        .trim()
        .max(GOAL_NOTE_MAX_LENGTH, `A note can be at most ${GOAL_NOTE_MAX_LENGTH.toLocaleString("en-US")} characters.`)
        .regex(NO_CONTROL_CHARACTERS_BUT_LINE_BREAKS, "Remove the invisible control characters from the text."),
    )
    .transform((note) => (note === "" ? null : note)),
});

// The support-trends setting: a ticked checkbox sends "on", an unticked one nothing.
export const supportTrendsSettingSchema = z.object({
  useSupportTrends: z
    .literal("on")
    .nullish()
    .transform((value) => value === "on"),
});

// A version number from the address (/cofounder/strategy/3): only a claim,
// looked up within the session's company.
export const planVersionSchema = z.coerce.number().int().positive().max(2_147_483_647);
