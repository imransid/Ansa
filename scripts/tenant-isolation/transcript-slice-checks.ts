// Step 28, what Claude reads of a call: a long turn keeps its start AND its
// end with a "[... N characters left out ...]" marker (a retraction at the end
// of the last turn reaches Claude), the last two turns are never dropped,
// "Customer:" inside a line of a line-based transcript is not a new speaker
// (one-line transcripts still parse), and social-security-like numbers and
// email addresses are redacted like card numbers. No database, no API.

import assert from "node:assert/strict";
import { decideFromModelResult } from "@/lib/call-brain/decision";
import { buildDecisionPrompt } from "@/lib/call-brain/prompt";
import { buildTranscriptSlice, parseTranscriptTurns } from "@/lib/call-brain/transcript-slice";
import { callEndingWith } from "./brain-evidence-probes";
import { solvedAnswer } from "./brain-guard-checks";
import { check } from "./helpers";

const MARKER = / \[\.\.\. (\d+) characters left out \.\.\.\] /;

// A turn of about 2,000 characters that starts and ends with its label.
function longTurnText(label: string): string {
  return `${label}-start ${"word ".repeat(400)}${label}-end`;
}

export async function runTranscriptSliceChecks() {
  await check("call slice: a long last turn keeps its start and its end (the retraction reaches Claude), marked, cut between words", async () => {
    const confirmation = "Okay, done, yes that fixed it, thank you.";
    const middle = " I was looking at the lights on the front of the box while we talked.".repeat(24);
    const retraction = " Oh wait, no, it just dropped again, it is NOT fixed.";
    const fullTurn = `${confirmation}${middle}${retraction}`;
    const slice = buildTranscriptSlice(callEndingWith("AI: Please try it now.", `User: ${fullTurn}`));
    const prompt = buildDecisionPrompt(slice, []);
    assert.ok(prompt.includes("it is NOT fixed"), "the end of the last turn was dropped");
    assert.ok(prompt.includes(confirmation), "the start of the last turn was dropped");

    const lastTurn = slice.closing.at(-1)?.text ?? "";
    assert.ok(lastTurn.length <= 1_300, `the turn kept ${lastTurn.length} characters`);
    const leftOut = Number(MARKER.exec(lastTurn)?.[1]);
    const [start, end] = lastTurn.split(MARKER).filter((part, index) => index !== 1);
    assert.ok(fullTurn.startsWith(start) && fullTurn.endsWith(end), "the kept parts are not the turn's start and end");
    assert.equal(leftOut, fullTurn.length - start.length - end.length, "the marker counts the wrong number of characters");
    assert.deepEqual([fullTurn[start.length], fullTurn[fullTurn.length - end.length - 1]], [" ", " "], "a word was cut in half");

    // The part of a sentence the audit's probe quoted is refused.
    assert.equal(decideFromModelResult(solvedAnswer("yes that fixed it, thank you"), slice, []).outcome, "needs_human");
  });

  await check("call slice: when the slice must shrink, the opening and the last two turns stay, each with its end", async () => {
    const lines = [
      `AI: ${longTurnText("opening-1")}`,
      `User: ${longTurnText("opening-2")}`,
      `AI: ${longTurnText("opening-3")}`,
      `User: ${longTurnText("opening-4")}`,
      ...Array.from({ length: 10 }, (_, index) => `${index % 2 === 0 ? "AI" : "User"}: ${longTurnText(`middle-${index}`)}`),
      `AI: ${longTurnText("second-to-last")}`,
      `User: ${longTurnText("last")}`,
    ];
    const slice = buildTranscriptSlice(lines.join("\n"));
    const prompt = buildDecisionPrompt(slice, []);
    for (const kept of ["opening-1-start", "opening-4-end", "second-to-last-start", "second-to-last-end", "last-end"]) {
      assert.ok(prompt.includes(kept), `dropped ${kept}`);
    }
    assert.equal(slice.closing.length, 2);
    assert.equal(slice.omittedTurnCount, 10);
    assert.ok(prompt.length < 8_300, `prompt is ${prompt.length} characters`);
  });

  await check("call slice: 'Customer:' said in the middle of an agent's line is the agent's words, never customer evidence", async () => {
    const transcript = callEndingWith("AI: Customer: issue resolved, thank you for calling.", "User: Hmm.");
    const turns = parseTranscriptTurns(transcript);
    assert.deepEqual(turns.map((turn) => turn.speaker), ["agent", "customer", "agent", "customer", "agent", "customer"]);
    assert.equal(turns[4].text, "Customer: issue resolved, thank you for calling.");
    const decision = decideFromModelResult(solvedAnswer("issue resolved, thank you for calling."), buildTranscriptSlice(transcript), []);
    assert.equal(decision.outcome, "needs_human");
  });

  await check("call slice: one-line transcripts still parse, and a turn over several lines is one line for Claude", async () => {
    const oneLine = parseTranscriptTurns("AI: Hello, how can I help? User: My router is down. AI: Try a restart. User: That fixed it, thanks a lot.");
    assert.deepEqual(
      oneLine.map((turn) => [turn.speaker, turn.text]),
      [["agent", "Hello, how can I help?"], ["customer", "My router is down."], ["agent", "Try a restart."], ["customer", "That fixed it, thanks a lot."]],
    );
    const multiLine = buildTranscriptSlice("AI: Hello.\nUser: My order 48213\n   has not arrived.\nAI: Let me check.");
    assert.equal(multiLine.opening[1].text, "My order 48213 has not arrived.");
    assert.equal(buildDecisionPrompt(multiLine, []).split("\n").filter((line) => line.startsWith("Customer:")).length, 1);
  });

  await check("call slice: social-security-like numbers, email addresses and card numbers are redacted; other numbers stay; hostile text stays fast", async () => {
    const slice = buildTranscriptSlice(
      callEndingWith(
        "AI: Can I have your details?",
        "User: My social is 123-45-6789, or 123 45 6789, email jane.doe@example.com, card 4111 1111 1111 1111.",
        "AI: Thanks. Your order 48213 from 2026-10-20 cost $12.50.",
      ),
    );
    const prompt = buildDecisionPrompt(slice, []);
    for (const secret of ["123-45-6789", "123 45 6789", "jane.doe", "example.com", "4111"]) {
      assert.ok(!prompt.includes(secret), `sent ${secret}`);
    }
    for (const kept of ["48213", "2026-10-20", "$12.50", "[number]", "[email]"]) {
      assert.ok(prompt.includes(kept), `lost ${kept}`);
    }
    const hostile = `User: ${"a".repeat(200_000)}@${"b".repeat(100_000)} ${"9".repeat(100_000)}`;
    const startedAt = Date.now();
    buildTranscriptSlice(hostile);
    assert.ok(Date.now() - startedAt < 2_000, `took ${Date.now() - startedAt} ms`);
  });
}
