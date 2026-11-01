// "Test your assistant" (Settings → Assistant, step 49): what the assistant
// would answer a customer's first message, with the same data, AI engine
// and checks as a real one. Nothing is saved, sent or alerted.

export type AssistantTestResult =
  | { ok: true; outcome: "reply"; text: string }
  | { ok: true; outcome: "handover"; holdingReply: string; why: string }
  | { ok: true; outcome: "no_reply" }
  | { ok: false; errors: { message?: string; fieldErrors?: Record<string, string[] | undefined> } };
