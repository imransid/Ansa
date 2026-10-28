import { z } from "zod";
import { KNOWLEDGE_QUESTION_MAX_LENGTH } from "@/lib/knowledge/limits";
import { toPlainSingleLine } from "@/lib/plain-text";
import { NO_LINE_BREAKS_OR_CONTROL_CHARACTERS } from "./control-characters";

// Vapi's "tool-calls" message (step 35): the voice assistant calls one of
// our tools during a live call. Used only AFTER the webhook signature was
// verified. z.object drops every field not listed here: message.artifact
// (the live transcript and recording links) and message.phoneNumber (which
// can hold the phone provider's secrets) are never kept. Field paths follow
// Vapi's docs (docs/research/vapi-tools-media-anthropic.md, section 1); not
// confirmed with a real Vapi account.

// The one tool we offer. Its definition in Vapi is in docs/going-live.md.
export const KNOWLEDGE_TOOL_NAME = "search_company_knowledge";

// More in one message is no assistant asking: the whole message is refused.
export const MAX_TOOL_CALLS_PER_MESSAGE = 10;

// Vapi's ids are echoed back in the answer, which must be one line.
const vapiIdSchema = z.string().min(1).max(200).regex(NO_LINE_BREAKS_OR_CONTROL_CHARACTERS);

export const vapiToolCallsMessageSchema = z.object({
  message: z.object({
    type: z.literal("tool-calls"),
    // Each entry is read on its own (vapiToolCallSchema), so one odd entry
    // doesn't leave the others unanswered.
    toolCallList: z.array(z.unknown()).max(MAX_TOOL_CALLS_PER_MESSAGE),
    // Only these two ids are read: phoneNumberId decides the company (through
    // phone_lines), id names the call its lookups are recorded under. A web
    // call has no phoneNumberId. null counts as missing: Vapi's JSON may
    // spell an empty field that way.
    call: z
      .object({
        id: vapiIdSchema.nullish(),
        phoneNumberId: vapiIdSchema.nullish(),
      })
      .nullish(),
  }),
});

export type VapiToolCallsMessage = z.infer<typeof vapiToolCallsMessageSchema>["message"];

// One entry of toolCallList. An entry without a usable id can't be answered
// (the answer names the id), so it is left out.
export const vapiToolCallSchema = z.object({
  id: vapiIdSchema,
  function: z.object({
    name: z.string().max(80).regex(NO_LINE_BREAKS_OR_CONTROL_CHARACTERS),
    arguments: z.unknown(),
  }),
});

export type VapiToolCall = z.infer<typeof vapiToolCallSchema>;

// Vapi's API spec types arguments as a JSON string, its docs show an object:
// both are read. A string that isn't JSON stays a string, and the schema
// below refuses it.
function parseArgumentsString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// search_company_knowledge's one argument: what the caller asked, on one
// line, as long as "Test what the AI finds" allows.
export const knowledgeToolArgumentsSchema = z.preprocess(
  parseArgumentsString,
  z.object({
    query: z.string().transform(toPlainSingleLine).pipe(z.string().min(1).max(KNOWLEDGE_QUESTION_MAX_LENGTH)),
  }),
);
