import { z } from "zod";

// Control characters (NUL, line breaks, tabs, escapes) have no place in an id
// or a name. Postgres refuses a NUL byte in text, so one that got through
// would crash the action instead of being refused, and a line break lets
// someone shape how the text is shown, or the one-name-per-line lists sent
// to Claude.
export const NO_CONTROL_CHARACTERS = /^[^\p{Cc}]*$/u;

// Lines also break at Unicode's own line and paragraph separators.
export const NO_LINE_BREAKS_OR_CONTROL_CHARACTERS = /^[^\p{Cc}\p{Zl}\p{Zp}]*$/u;

// A person's id sent by a form. Better Auth makes these ids, so they are not
// always uuids. Only a claim: the database checks the person is in the
// session's company.
export const formUserIdSchema = z.string().min(1).max(100).regex(NO_CONTROL_CHARACTERS);
