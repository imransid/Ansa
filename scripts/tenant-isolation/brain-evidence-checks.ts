// Step 28, the "solved" guard: Claude's evidence must be ONE WHOLE sentence of
// the customer's, from their last two turns (never the opening), at least
// three words, not a question, and not cut by a "[... left out ...]" marker
// or a "...". Every probe from the audit is refused, a genuine confirmation
// passes however it is typed (also a long one), sentences end only at a real
// sentence end, and nothing ever defaults to "solved". No database, no API.

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { decideFromModelResult } from "@/lib/call-brain/decision";
import { isCustomerConfirmation } from "@/lib/call-brain/resolution-evidence";
import { buildTranscriptSlice, type TranscriptSlice } from "@/lib/call-brain/transcript-slice";
import type { ModelResult } from "@/lib/model-request";
import { callEndingWith, PROBES } from "./brain-evidence-probes";
import { answer, SOLVED_TRANSCRIPT, solvedAnswer } from "./brain-guard-checks";
import { check } from "./helpers";

// A slice whose last turn is this customer text (it may hold a marker).
function sliceEndingWith(customerText: string): TranscriptSlice {
  const closing = [{ speaker: "agent" as const, text: "Anything else?" }, { speaker: "customer" as const, text: customerText }];
  return { opening: [], closing, omittedTurnCount: 0, customerTurnCount: 1 };
}

// Every run of consecutive words in every turn of a transcript.
function everyRunOfWords(transcript: string): string[] {
  const runs: string[] = [];
  for (const line of transcript.split("\n")) {
    const words = line.slice(line.indexOf(":") + 1).trim().split(" ");
    for (let start = 0; start < words.length; start++) {
      for (let end = start + 1; end <= words.length; end++) {
        runs.push(words.slice(start, end).join(" "));
      }
    }
  }
  return runs;
}

// Where the app's code sets a "solved" outcome, as "file:line".
const SETS_SOLVED = /\b(outcome|aiOutcome)\s*(:\s*"solved"\s*[,}]|=\s*"solved")/;
async function findSolvedAssignments(): Promise<string[]> {
  const found: string[] = [];
  for (const folder of ["adapters", "app", "components", "db", "lib", "services"]) {
    const files = (await readdir(folder, { recursive: true })).filter((file) => /\.tsx?$/.test(file));
    for (const file of files) {
      const lines = (await readFile(path.join(folder, file), "utf8")).split("\n");
      for (let index = 0; index < lines.length; index++) {
        if (SETS_SOLVED.test(lines[index])) {
          found.push(`${path.join(folder, file)}:${index + 1}`);
        }
      }
    }
  }
  return found;
}

export async function runBrainEvidenceChecks() {
  await check("brain evidence: every audit probe is refused (thanks, a negation, a question, part of a word, the opening, a short call, a '...' pause, a filler before a question, 'Dr.')", async () => {
    for (const probe of PROBES) {
      const decision = decideFromModelResult(solvedAnswer(probe.evidence), buildTranscriptSlice(probe.transcript), []);
      assert.deepEqual([decision.outcome, decision.reasonCode], ["needs_human", "unverified_resolution"], `accepted ${probe.why}`);
    }
  });

  await check("brain evidence: a genuine whole sentence passes however it is typed, from either of the customer's last two turns", async () => {
    const slice = buildTranscriptSlice(SOLVED_TRANSCRIPT);
    const typings = [
      "That fixed it, thank you so much.",
      "that fixed it, thank you so much",
      "THAT FIXED IT,  THANK YOU SO MUCH!",
      "“That fixed it, thank you so much.”",
      "Ｔhat fixed it, thank you so much.", // a full-width letter (NFKC)
    ];
    for (const evidence of typings) {
      assert.equal(decideFromModelResult(solvedAnswer(evidence), slice, []).outcome, "solved", `refused "${evidence}"`);
    }
    const earlierTurn = callEndingWith("AI: I refunded it.", "User: Yes, it’s working perfectly now.", "AI: Anything else?", "User: Bye.");
    for (const evidence of ["Yes, it's working perfectly now.", "Yes, its working perfectly now"]) {
      assert.equal(decideFromModelResult(solvedAnswer(evidence), buildTranscriptSlice(earlierTurn), []).outcome, "solved", evidence);
    }
  });

  await check("brain evidence: a sentence a '[... left out ...]' marker cut never counts; whole sentences next to it do", async () => {
    const afterMarker = sliceEndingWith("Blah blah [... 812 characters left out ...] it's working now. Thanks, that fixed everything.");
    assert.equal(isCustomerConfirmation("it's working now", afterMarker), false);
    assert.equal(isCustomerConfirmation("Thanks, that fixed everything.", afterMarker), true);
    const unfinished = sliceEndingWith("So I tried everything and it works now [... 900 characters left out ...] bye for now.");
    assert.equal(isCustomerConfirmation("So I tried everything and it works now", unfinished), false);
    const finished = sliceEndingWith("That fixed it, thanks. [... 900 characters left out ...] bye for now.");
    assert.equal(isCustomerConfirmation("That fixed it, thanks.", finished), true);
  });

  await check("brain evidence: a '...' cuts like a marker; 'Dr.', 'e.g.' and '12.50' don't end a sentence; a long sentence is judged, not refused", async () => {
    const pause = sliceEndingWith("Hmm... okay, I see it now. That fixed it, thank you so much.");
    assert.equal(isCustomerConfirmation("That fixed it, thank you so much.", pause), true, "a whole sentence after the pause");
    assert.equal(isCustomerConfirmation("okay, I see it now.", pause), false, "it may be the end of the sentence the pause cut");
    assert.equal(isCustomerConfirmation("That fixed it, thanks...", sliceEndingWith("That fixed it, thanks... bye.")), false);
    assert.equal(isCustomerConfirmation("Not sure. . . it works now.", sliceEndingWith("Not sure. . . it works now.")), false);

    const abbreviation = sliceEndingWith("Thanks, Dr. Lee fixed it for me.");
    assert.equal(isCustomerConfirmation("Thanks, Dr. Lee fixed it for me.", abbreviation), true);
    assert.equal(isCustomerConfirmation("Lee fixed it for me.", abbreviation), false);
    const decimal = sliceEndingWith("I paid 12.50 and it works now, thanks.");
    assert.equal(isCustomerConfirmation("I paid 12.50 and it works now, thanks.", decimal), true);
    assert.equal(isCustomerConfirmation("50 and it works now, thanks.", decimal), false);

    // Longer than the old 300-character cap on Claude's evidence.
    const longSentence = `Yes, that fixed it, ${"and the connection has stayed up the whole time we have been talking, ".repeat(5)}thank you so much.`;
    assert.ok(longSentence.length > 300 && longSentence.length < 1_300);
    const longCall = buildTranscriptSlice(callEndingWith("AI: I changed the wifi channel.", `User: ${longSentence}`, "AI: Goodbye."));
    const decision = decideFromModelResult(solvedAnswer(longSentence), longCall, []);
    assert.deepEqual([decision.outcome, decision.reasonCode], ["solved", "model_solved"]);
  });

  await check("brain evidence: of every run of words in the solved call, only the customer's two closing sentences pass", async () => {
    const slice = buildTranscriptSlice(SOLVED_TRANSCRIPT);
    const accepted = everyRunOfWords(SOLVED_TRANSCRIPT).filter((run) => decideFromModelResult(solvedAnswer(run), slice, []).outcome === "solved");
    assert.deepEqual(accepted, ["No, that's all.", "That fixed it, thank you so much."]);
  });

  await check("brain evidence: nothing defaults to 'solved': no answer, a failure or a needs_human never becomes it, and only decision.ts sets it", async () => {
    const slice = buildTranscriptSlice(SOLVED_TRANSCRIPT);
    const evidence = "That fixed it, thank you so much.";
    const neverSolved: ModelResult[] = [
      { kind: "unavailable" },
      { kind: "refused" },
      { kind: "truncated" },
      { kind: "unexpected-stop" },
      { kind: "error", errorName: "APIConnectionTimeoutError" },
      { kind: "ok", outputText: "", usage: { inputTokens: 1, outputTokens: 1 } },
      answer({ outcome: "needs_human", customer_issue: "x", resolution_evidence: evidence, reason: "x", ticket_subject: "x" }),
      answer({ outcome: "solved", customer_issue: "x", resolution_evidence: evidence, reason: "x" }), // no subject
    ];
    for (const result of neverSolved) {
      assert.equal(decideFromModelResult(result, slice, []).outcome, "needs_human", JSON.stringify(result));
    }
    // Any new place that sets "solved" must go through isCustomerConfirmation (CLAUDE.md).
    const places = await findSolvedAssignments();
    assert.equal(places.length, 1, `"solved" is set in: ${places.join(", ")}`);
    assert.ok(places[0].startsWith(path.join("lib", "call-brain", "decision.ts")), places[0]);
  });
}
