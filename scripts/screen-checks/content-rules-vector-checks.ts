// The browser's content rules and core's agree. Since the rewrite the rules
// live twice: here (lib/content-rules.ts, lib/content-studio/: the editor's
// live counts and issues) and in core (core/internal/contentrules: what an
// approval and the publishing queue decide). The vectors in
// core/internal/contentrules/testdata/old_rules.json were made by running
// these TypeScript rules; core's Go copy is tested against them
// (oldrules_test.go), and this check replays them here, so a change made on
// one side only fails one of the two.

import assert from "node:assert/strict";
import { checkContentRules, type DraftContent } from "@/lib/content-rules";
import { cleanDraftLine, cleanDraftLines, cutRunsOfMarks, hasTooManyMarksInARow } from "@/lib/content-studio/draft-text";
import { cleanModelHashtags, readTypedHashtags } from "@/lib/content-studio/hashtags";
import { measureText } from "@/lib/content-studio/text-measure";
import { check } from "./check";
import { read } from "./source-helpers";

type Vectors = {
  measures: { text: string; x: number; characters: number; bytes: number }[];
  cleaning: { text: string; line: string; lines: string; cut: string; tooMany: boolean }[];
  typed: { text: string; hashtags: string[]; invalid: string[] }[];
  model: { tags: string[]; kept: string[] }[];
  issues: { draft: DraftContent; media: { kind: "image" | "video"; altText: string } | null; words: string[]; issues: unknown[] }[];
};

// A short name for a vector's text in a failure message.
function named(text: string): string {
  return JSON.stringify(text.length > 40 ? `${text.slice(0, 40)}...` : text);
}

export async function runContentRulesVectorChecks() {
  await check("content rules: the browser's rules give the answers core's Go copy is tested against (core/internal/contentrules/testdata/old_rules.json)", async () => {
    const vectors = JSON.parse(await read("core/internal/contentrules/testdata/old_rules.json")) as Vectors;
    assert.ok(vectors.measures.length > 0 && vectors.issues.length > 0, "the vectors are empty");
    for (const vector of vectors.measures) {
      const counted = { x: measureText(vector.text, "x"), characters: measureText(vector.text, "characters"), bytes: measureText(vector.text, "utf8-bytes") };
      assert.deepEqual(counted, { x: vector.x, characters: vector.characters, bytes: vector.bytes }, `counting ${named(vector.text)}`);
    }
    for (const vector of vectors.cleaning) {
      const cleaned = { line: cleanDraftLine(vector.text), lines: cleanDraftLines(vector.text), cut: cutRunsOfMarks(vector.text), tooMany: hasTooManyMarksInARow(vector.text) };
      assert.deepEqual(cleaned, { line: vector.line, lines: vector.lines, cut: vector.cut, tooMany: vector.tooMany }, `cleaning ${named(vector.text)}`);
    }
    for (const vector of vectors.typed) {
      assert.deepEqual(readTypedHashtags(vector.text), { hashtags: vector.hashtags, invalid: vector.invalid }, `typed hashtags ${named(vector.text)}`);
    }
    for (const vector of vectors.model) {
      assert.deepEqual(cleanModelHashtags(vector.tags), vector.kept, "the AI's hashtags");
    }
    for (const vector of vectors.issues) {
      const issues = checkContentRules(vector.draft, { media: vector.media, wordsToAvoid: vector.words });
      assert.deepEqual(issues, vector.issues, `issues of a ${vector.draft.platform} ${vector.draft.format}`);
    }
  });
}
