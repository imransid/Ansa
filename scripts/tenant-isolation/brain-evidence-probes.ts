// The audit's probes for the "solved" guard (step 28, finding brain/5): calls
// where Claude could quote real words of the customer's that do NOT confirm
// the problem is solved, or that the guard refuses on purpose (the opening
// turns). Used by brain-evidence-checks.ts.

// The first four turns of every probe call: the opening, never evidence.
const OPENING = [
  "AI: Thanks for calling. How can I help?",
  "User: My card was charged twice for one order.",
  "AI: Let me look at your account. I can see both charges.",
  "User: Okay.",
];

export function callEndingWith(...lastLines: string[]): string {
  return [...OPENING, ...lastLines].join("\n");
}

// Each quote really is in the call, and each one was accepted before step 28
// (made-up quotes and the agent's words were already refused: brain-guard-checks.ts).
export const PROBES: { why: string; transcript: string; evidence: string }[] = [
  {
    why: "generic thanks before a complaint",
    transcript: callEndingWith("AI: I refunded the second charge.", "User: Thank you, but honestly this is the third time and it still doesn't work.", "AI: Goodbye."),
    evidence: "Thank you",
  },
  {
    why: "the end of a negated sentence",
    transcript: callEndingWith("AI: I reset your account.", "User: I don't think it's working now.", "AI: Goodbye."),
    evidence: "it's working now",
  },
  {
    why: "part of a question",
    transcript: callEndingWith("AI: I refunded the second charge.", "User: Has that fixed it? I still see two charges.", "AI: It takes a few days."),
    evidence: "that fixed it",
  },
  {
    why: "a whole question",
    transcript: callEndingWith("AI: I refunded the second charge.", "User: Has that fixed it? I still see two charges.", "AI: It takes a few days."),
    evidence: "Has that fixed it?",
  },
  {
    why: "a question whose question mark speech-to-text dropped",
    transcript: callEndingWith("AI: I refunded the second charge.", "User: has that fixed it", "AI: It takes a few days."),
    evidence: "has that fixed it",
  },
  {
    why: "a tag question",
    transcript: callEndingWith("AI: I refunded the second charge.", "User: That fixed it, right", "AI: It should."),
    evidence: "That fixed it, right",
  },
  {
    why: "part of a word",
    transcript: callEndingWith("AI: Please open the billing sheet.", "User: I opened that worksheet again.", "AI: Goodbye."),
    evidence: "opened that works",
  },
  {
    why: "a whole sentence of two words",
    transcript: callEndingWith("AI: I refunded the second charge.", "User: That works.", "AI: Goodbye."),
    evidence: "That works.",
  },
  {
    why: "two sentences at once",
    transcript: callEndingWith("AI: I refunded the second charge.", "User: Okay, done. That fixed it, thanks a lot.", "AI: Goodbye."),
    evidence: "Okay, done. That fixed it, thanks a lot.",
  },
  {
    why: "a confirmation the customer took back in their last two turns",
    transcript: callEndingWith(
      "AI: I refunded the second charge.",
      "User: That fixed it, thank you.",
      "AI: Great.",
      "User: Wait, I see it again.",
      "AI: Let me check.",
      "User: No, it is still charged twice.",
    ),
    evidence: "That fixed it, thank you.",
  },
  {
    why: "the opening's problem description",
    transcript: [
      "AI: Thanks for calling. How can I help?",
      "User: Last month your reset fixed it. Now the router drops again.",
      "AI: Let me check the line.",
      "User: Sure.",
      "AI: I booked a technician for Friday.",
      "User: Okay, Friday is fine.",
      "AI: Goodbye.",
    ].join("\n"),
    evidence: "Last month your reset fixed it.",
  },
  {
    why: "a short call, all of it opening turns",
    transcript: ["AI: Hello.", "User: My reset link fails.", "AI: I sent a new one.", "User: That worked, thank you so much."].join("\n"),
    evidence: "That worked, thank you so much.",
  },
  {
    // A known gap (CLAUDE.md): the confirmation is in the 4th turn, an opening turn.
    why: "a five-turn call whose confirmation is in the opening turns",
    transcript: ["AI: Hello.", "User: My reset link fails.", "AI: I sent a new one.", "User: That worked, thank you so much.", "AI: Goodbye."].join("\n"),
    evidence: "That worked, thank you so much.",
  },
  {
    why: "the end of a sentence after a pause written as '...'",
    transcript: callEndingWith("AI: I reset your account.", "User: I don't think... it's working now.", "AI: Goodbye."),
    evidence: "it's working now.",
  },
  {
    why: "the end of a sentence after a pause written as '…'",
    transcript: callEndingWith("AI: I reset your account.", "User: I don't think… it's working now.", "AI: Goodbye."),
    evidence: "it's working now.",
  },
  {
    why: "the start of a sentence cut by '...' and taken back",
    transcript: callEndingWith("AI: I refunded the second charge.", "User: That fixed it... oh wait, no, it's down again.", "AI: Let me check."),
    evidence: "That fixed it...",
  },
  ...["So is it working now", "Okay, is that fixed now", "Um, did that fix it", "And does it work now", "Wait, is it fixed now"].map((question) => ({
    why: `a question that lost its "?" and starts with a filler word: ${question}`,
    transcript: callEndingWith("AI: I refunded the second charge.", `User: ${question}`, "AI: It should be."),
    evidence: question,
  })),
  {
    why: "the end of a sentence after 'Dr.'",
    transcript: callEndingWith("AI: Dr. Lee changed your settings.", "User: I don't think Dr. Lee's fix is working now.", "AI: Goodbye."),
    evidence: "Lee's fix is working now.",
  },
  {
    why: "the end of a sentence after 'e.g.'",
    transcript: callEndingWith("AI: Does the router work?", "User: Not really, e.g. the router works now only on wifi.", "AI: Goodbye."),
    evidence: "the router works now only on wifi.",
  },
];
