import type { FormErrors } from "@/lib/form-result";

// "Test your assistant" (Settings → Assistant, step 49): what the assistant
// would answer a customer's first message, with the same data, AI engine
// and checks as a real one. Nothing is saved, sent or alerted. `question`
// is what was typed, shown above the answer: React empties the box after
// the action runs (a refused test gets it back in errors.values instead).

export type AssistantTestResult =
  | { ok: true; question: string; outcome: "reply"; text: string }
  | { ok: true; question: string; outcome: "handover"; holdingReply: string; why: string }
  | { ok: true; question: string; outcome: "no_reply" }
  | { ok: false; errors: FormErrors };
