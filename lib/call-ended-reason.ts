// How a call ended, in plain words for the Calls pages: the phone provider
// reports a code ("customer-ended-call"), which the team never needs to
// read. A code this list doesn't know is named only by its kind.
const ENDED_REASON_TEXT: Record<string, string> = {
  "customer-ended-call": "The caller hung up",
  "assistant-ended-call": "The AI ended the call",
  "assistant-said-end-call-phrase": "The AI ended the call",
  "assistant-forwarded-call": "The AI passed the call on",
  "silence-timed-out": "Nobody spoke for a while",
  "exceeded-max-duration": "It reached the longest call allowed",
  voicemail: "It reached a voicemail",
  "customer-busy": "The line was busy",
  "customer-did-not-answer": "Nobody answered",
  "manually-canceled": "It was cancelled",
};

export function describeEndedReason(reason: string | null): string {
  if (!reason) {
    return "-";
  }
  if (Object.hasOwn(ENDED_REASON_TEXT, reason)) {
    return ENDED_REASON_TEXT[reason];
  }
  return reason.includes("error") ? "A technical problem ended it" : "Another reason";
}
