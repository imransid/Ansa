import { z } from "zod";
import { cutPlanText } from "@/lib/marketing-plan/plan-schema";
import type { ModelResult } from "@/lib/model-request";
import { toPlainSingleLine } from "@/lib/plain-text";
import { REVIEW_LIMIT_TEXT_MAX_LENGTH, REVIEW_LIST_LIMITS, REVIEW_TEXT_MAX_LENGTH } from "./limits";
import { numbersInInput, type ReviewInput } from "./review-input";
import { writesOnlyAllowedNumbers } from "./text-numbers";

// Reading Claude's performance review (step 42), written twice like every
// other use: the JSON schema the API enforces (review-json-schema.ts) and
// this Zod schema, strict (a field we didn't ask for makes it unusable).
// Then THIS CODE checks every number: a finding is kept only when each
// number it cites is exactly one the request held (that post's or group's,
// under that name), and its text writes no other; a wrong or invented
// number drops the whole finding. Recommendations keep only the findings
// they follow from, and none without. No finding left = no review: nothing
// is saved. Pure.

const evidenceSchema = z.object({ post_label: z.string(), group: z.string(), metric: z.string(), value: z.number() }).strict();
const findingSchema = z.object({ text: z.string(), evidence: z.array(evidenceSchema).max(50) }).strict();
const recommendationSchema = z.object({ text: z.string(), based_on_findings: z.array(z.number().int()).max(50) }).strict();

export const performanceReviewAnswerSchema = z
  .object({
    findings: z.array(findingSchema).max(50),
    recommendations: z.array(recommendationSchema).max(50),
    limits_of_this_data: z.array(z.string()).max(50),
  })
  .strict();

// One cited number: a post's (post_label) or a group's (group), the other "".
export type ReviewEvidence = { post_label: string; group: string; metric: string; value: number };
export type ReviewFinding = { text: string; evidence: ReviewEvidence[] };
// based_on_findings: the kept findings' numbers, 1 for the first.
export type ReviewRecommendation = { text: string; based_on_findings: number[] };
export type PerformanceReview = { findings: ReviewFinding[]; recommendations: ReviewRecommendation[]; limits_of_this_data: string[] };

type AnswerFinding = z.infer<typeof findingSchema>;

// kept: the review to save. unusable: none to read (not asked, refused,
// cut off, failed, not JSON, another shape). all_dropped: no finding's
// numbers all checked out.
export type ReviewReading = { kind: "kept"; review: PerformanceReview } | { kind: "unusable" } | { kind: "all_dropped" };

export function readPerformanceReviewAnswer(result: ModelResult, input: ReviewInput): ReviewReading {
  if (result.kind !== "ok") {
    return { kind: "unusable" };
  }
  const parsed = performanceReviewAnswerSchema.safeParse(parseJsonOrNull(result.outputText));
  if (!parsed.success) {
    return { kind: "unusable" };
  }
  const review = checkReviewAnswer(parsed.data, input);
  return review ? { kind: "kept", review } : { kind: "all_dropped" };
}

// The findings whose numbers all match the request, the recommendations
// that follow from them (renumbered), and the limits writing no number the
// request doesn't hold.
export function checkReviewAnswer(answer: z.infer<typeof performanceReviewAnswerSchema>, input: ReviewInput): PerformanceReview | null {
  const kept: { answerNumber: number; finding: ReviewFinding }[] = [];
  answer.findings.forEach((finding, index) => {
    const checked = checkFinding(finding, input);
    if (checked && kept.length < REVIEW_LIST_LIMITS.findings) {
      kept.push({ answerNumber: index + 1, finding: checked });
    }
  });
  if (kept.length === 0) {
    return null;
  }
  const findings = kept.map((entry) => entry.finding);
  const keptNumberOf = new Map(kept.map((entry, index) => [entry.answerNumber, index + 1]));
  const recommendations = answer.recommendations
    .flatMap((recommendation) => {
      const basedOn = [...new Set(recommendation.based_on_findings.flatMap((number) => keptNumberOf.get(number) ?? []))].sort((a, b) => a - b);
      const text = cleanText(recommendation.text, REVIEW_TEXT_MAX_LENGTH);
      const cited = basedOn.map((number) => findings[number - 1]);
      const allowed = cited.flatMap((finding) => finding.evidence.map((evidence) => evidence.value));
      const isUsable = basedOn.length > 0 && text !== "" && writesOnlyAllowedNumbers(text, allowed, namesCitedBy(cited, input));
      return isUsable ? [{ text, based_on_findings: basedOn }] : [];
    })
    .slice(0, REVIEW_LIST_LIMITS.recommendations);
  const inputNumbers = numbersInInput(input);
  const everyName = [...input.posts.map((post) => post.topic), ...input.groups.map((group) => group.name)];
  const limits = answer.limits_of_this_data
    .map((limit) => cleanText(limit, REVIEW_LIMIT_TEXT_MAX_LENGTH))
    .filter((limit) => limit !== "" && writesOnlyAllowedNumbers(limit, inputNumbers, everyName))
    .slice(0, REVIEW_LIST_LIMITS.limits);
  return { findings, recommendations, limits_of_this_data: limits };
}

// A finding as kept, or null when any number it cites isn't in the request
// as cited, it cites none, or its text writes a number it doesn't cite.
function checkFinding(finding: AnswerFinding, input: ReviewInput): ReviewFinding | null {
  const text = cleanText(finding.text, REVIEW_TEXT_MAX_LENGTH);
  const evidence: ReviewEvidence[] = [];
  for (const entry of finding.evidence) {
    const checked = checkEvidence(entry, input);
    if (!checked) {
      return null;
    }
    const isRepeat = evidence.some((seen) => seen.post_label === checked.post_label && seen.group === checked.group && seen.metric === checked.metric);
    if (!isRepeat) {
      evidence.push(checked);
    }
  }
  // Only the first ones are kept, so the text may write only theirs.
  const kept = { text, evidence: evidence.slice(0, REVIEW_LIST_LIMITS.evidencePerFinding) };
  if (text === "" || kept.evidence.length === 0) {
    return null;
  }
  const values = kept.evidence.map((entry) => entry.value);
  return writesOnlyAllowedNumbers(text, values, namesCitedBy([kept], input)) ? kept : null;
}

// One cited number, exactly as the request held it, or null.
function checkEvidence(entry: ReviewEvidence, input: ReviewInput): ReviewEvidence | null {
  const postLabel = entry.post_label.trim();
  const group = entry.group.trim();
  const metric = entry.metric.trim();
  if ((postLabel === "") === (group === "")) {
    return null;
  }
  const numbers: Record<string, number | undefined> | undefined = postLabel
    ? input.posts.find((post) => post.label === postLabel)?.numbers
    : input.groups.find((candidate) => candidate.label === group)?.numbers;
  const given = numbers && Object.hasOwn(numbers, metric) ? numbers[metric] : undefined;
  if (given === undefined || given !== entry.value) {
    return null;
  }
  return { post_label: postLabel, group, metric, value: given };
}

// The topics of the posts and the names of the groups these findings cite:
// a number quoted from one ("Top 5 breads") is no result.
function namesCitedBy(findings: ReviewFinding[], input: ReviewInput): string[] {
  return findings.flatMap((finding) =>
    finding.evidence.map((entry) =>
      entry.post_label
        ? (input.posts.find((post) => post.label === entry.post_label)?.topic ?? "")
        : (input.groups.find((group) => group.label === entry.group)?.name ?? ""),
    ),
  );
}

// One plain line, cut at a word with "..." when too long.
function cleanText(text: string, maxLength: number): string {
  return cutPlanText(toPlainSingleLine(text), maxLength);
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
