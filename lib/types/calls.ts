import type { CallAnalysisStatus, CallOutcome, DecisionSource, RecordingStatus } from "@/db/schema";
import type { CallOutcomeFilter } from "@/lib/validation/list-queries";

// Calls as the Calls list and one call's page read them.

export type CallListRow = {
  id: string;
  callerNumber: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  endedReason: string | null;
  analysisStatus: CallAnalysisStatus;
  aiOutcome: CallOutcome | null;
  createdAt: Date;
  analysisStartedAt: Date | null;
  // Never analyzed, or its analysis started, 5+ minutes ago and still not
  // decided: the run was cut off. The list says "Stuck: analyze now" (step 27).
  analysisStuck: boolean;
  // When a teammate escalated this "solved" call to a ticket (step 31), or null.
  escalatedAt: Date | null;
};

// How many calls each filter of the list holds (step 29).
export type CallOutcomeCounts = Record<CallOutcomeFilter, number>;

// One call as the Calls list shows it.
export type CallListItem = CallListRow;

export type CallDetail = CallListItem & {
  transcript: string | null;
  // True when a transcript is stored but could not be decrypted (wrong key, damaged data).
  transcriptUnreadable: boolean;
  recordingStatus: RecordingStatus;
  // The ticket created from this call (step 8), if any.
  ticketNumber: number | null;
  // Who escalated this call although the AI marked it solved, and when
  // (step 31), or null.
  escalation: { byName: string | null; at: Date } | null;
  analysis: {
    source: DecisionSource | null;
    reasonCode: string | null;
    model: string | null;
    decidedAt: Date | null;
    issue: string | null;
    explanation: string | null;
    // When asking Claude failed: the error's class ("AuthenticationError").
    errorClass: string | null;
    // "solved" only: the customer's sentence that confirmed it (step 31).
    // Null for calls decided before step 31, and when it can't be decrypted.
    evidence: string | null;
    // Never analyzed, or the analysis seems to have died.
    canAnalyzeNow: boolean;
    // The AI marked it solved and it has no ticket yet: "Escalate to a
    // ticket" is offered (step 31). The escalation itself checks again.
    canEscalate: boolean;
  };
};
