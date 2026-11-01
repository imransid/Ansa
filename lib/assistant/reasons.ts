// Why the assistant handed a conversation to a person (step 49): sent the
// restaurant's holding reply instead of its own text, opened a request
// ("Needs you") and alerted the owner. Pure: the activity log's CHECK
// (db/schema/conversations.ts), the request's text and the pages share them.

export const HANDOVER_REASONS = [
  "unsure",
  "complaint",
  "refund",
  "asked_for_person",
  "order",
  "needs_decision",
  "important_person",
  "price_not_on_menu",
  "refund_promise",
  "unknown_link",
  "unusable_answer",
  "model_failed",
  "model_unavailable",
  "reply_limit",
  "send_failed",
  // Step 52: a placed order the customer wants changed or cancelled, and an
  // order ansa couldn't write up (a dish it can't place, nothing to confirm).
  "order_change",
  "order_unclear",
] as const;
export type HandoverReason = (typeof HANDOVER_REASONS)[number];

// The reasons the AI itself may give; the others are ansa's own findings.
export const AI_HANDOVER_REASONS = ["unsure", "complaint", "refund", "asked_for_person", "order", "needs_decision", "order_change"] as const;
export type AiHandoverReason = (typeof AI_HANDOVER_REASONS)[number];

// One plain sentence each, for the request and the owner's alert.
// Neutral words ("They"): the same texts serve a business's customers and a
// person's contacts (step 50).
export const HANDOVER_REASON_TEXT: Record<HandoverReason, string> = {
  unsure: "The assistant wasn't sure how to answer.",
  complaint: "They complained.",
  refund: "They asked for a refund or compensation.",
  asked_for_person: "They asked to talk to a person.",
  // A restaurant that doesn't take orders through ansa (step 52: one that does lets ansa take them).
  order: "They want to place an order.",
  // A person's assistant (step 50): a meeting, a time, money or a promise.
  needs_decision: "It needs your decision.",
  // Step 51: someone you marked important always comes to you.
  important_person: "They're one of your important people.",
  price_not_on_menu: "The assistant's reply named a price that isn't on your menu, so ansa didn't send it.",
  refund_promise: "The assistant's reply promised a refund or compensation, so ansa didn't send it.",
  unknown_link: "The assistant's reply had a link ansa doesn't know, so ansa didn't send it.",
  unusable_answer: "The assistant's answer couldn't be read.",
  model_failed: "The AI didn't answer in time.",
  model_unavailable: "No AI is set up for the assistant (Settings → Assistant → AI engine).",
  reply_limit: "The assistant reached its replies for this hour.",
  send_failed: "The assistant's reply couldn't be sent.",
  order_change: "They want to change or cancel an order they placed.",
  order_unclear: "ansa couldn't write up their order (a dish it couldn't find on the menu).",
};
