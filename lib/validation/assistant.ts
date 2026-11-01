import { z } from "zod";
import { AI_ENGINES, ANTHROPIC_KEY_PATTERN } from "@/lib/assistant/engine";
import { REPLY_MAX_LENGTH } from "@/lib/conversations";
import { multilineText } from "./ticket-fields";

// Settings → Assistant's AI engine (step 49): which one, and a new key (blank
// = keep the saved one) or "remove". The key's shape is checked here; it is
// never sent back to the form.
export const aiEngineSchema = z.object({
  engine: z.enum(AI_ENGINES, { error: "Pick an AI engine." }),
  apiKey: z
    .string()
    .nullish()
    .transform((key) => (key ?? "").trim())
    .refine((key) => key === "" || ANTHROPIC_KEY_PATTERN.test(key), "That doesn't look like a Claude API key (it starts with sk-ant-)."),
  removeKey: z
    .string()
    .nullish()
    .transform((value) => value === "on"),
});

// "Test your assistant": a customer's message as the owner types it.
export const assistantTestSchema = z.object({
  text: multilineText().pipe(
    z
      .string()
      .trim()
      .min(1, "Write a customer's message first.")
      .max(REPLY_MAX_LENGTH, `A message can be at most ${REPLY_MAX_LENGTH.toLocaleString("en-US")} characters.`)
      .regex(/^(?:[^\p{Cc}]|[\n\t])*$/u, "Remove the invisible control characters from the text."),
  ),
});
