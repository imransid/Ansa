import { z } from "zod";
import { REPLY_MAX_LENGTH } from "@/lib/conversations";
import { multilineText } from "./ticket-fields";

// The Inbox's forms (step 47). An id from a form is only a claim:
// lowercased, as Postgres gives it back, and matched with the company in /db.
export const conversationIdSchema = z.uuid().transform((id) => id.toLowerCase());

export const conversationInputSchema = z.object({ conversationId: conversationIdSchema });

// A person's reply: several lines as typed (a line break counts once), no
// control characters (Postgres refuses NUL).
export const replySchema = z.object({
  conversationId: conversationIdSchema,
  text: multilineText().pipe(
    z
      .string()
      .trim()
      .min(1, "Write a reply first.")
      .max(REPLY_MAX_LENGTH, `A reply can be at most ${REPLY_MAX_LENGTH.toLocaleString("en-US")} characters.`)
      .regex(/^(?:[^\p{Cc}]|[\n\t])*$/u, "Remove the invisible control characters from the text."),
  ),
  // The assistant's waiting reply this one replaces (edited, step 49); "" = none.
  replacesDraftId: z
    .union([z.literal(""), z.uuid()])
    .nullish()
    .transform((id) => (id ? id.toLowerCase() : null)),
});

// One of the assistant's waiting replies ("Ask me first", step 49).
export const draftInputSchema = z.object({
  conversationId: conversationIdSchema,
  messageId: z.uuid().transform((id) => id.toLowerCase()),
});
