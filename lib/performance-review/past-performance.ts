import { redactedAndCut, textForPrompt } from "@/lib/cofounder/prompt-text";
import { DRAFT_PILLAR_MAX_LENGTH } from "@/lib/content-studio/limits";
import { escapeHtml } from "@/lib/escape-html";
import { REVIEW_LIMIT_TEXT_MAX_LENGTH, REVIEW_TEXT_MAX_LENGTH, REVIEW_TOPIC_CHARACTERS } from "./limits";
import type { PerformanceReview } from "./review-answer";
import type { ReviewInput } from "./review-input";
import { describeEvidence } from "./stored-review";

// The newest performance review as the marketing planner (step 37) reads it
// (step 42): <past_performance>, its period, each finding with the numbers
// it cites in words, the recommendations and the limits. Only what the
// review kept: every number in it was checked against what the platforms
// gave (lib/performance-review/review-answer.ts). Every text escaped, card
// numbers hidden (textForPrompt); the posts' topics and pillar names as the
// review's own request held them (review-prompt.ts), never the whole text
// the review stored for the Analytics page. Pure.

export const PAST_PERFORMANCE_PROMPT_RULE =
  '<past_performance>, when present: the newest review of how the business\'s posts did, measured by the platforms, with the numbers each finding rests on and what was recommended then (simulated="yes": numbers made up to test the app, not measured). Build on what worked; never invent other results, and never write a number it doesn\'t hold.';

export function buildPastPerformanceBlock(review: PerformanceReview, input: ReviewInput, madeAt: Date): string {
  const asSent = withTextsAsSent(input);
  const findings = review.findings.map((finding) => {
    const numbers = finding.evidence.map((evidence) => {
      const described = describeEvidence(evidence, asSent);
      return `<number source="${escapeHtml(described.source)}" metric="${escapeHtml(described.metric)}" value="${evidence.value}"/>`;
    });
    return `<finding>${textForPrompt(finding.text, REVIEW_TEXT_MAX_LENGTH)}\n${numbers.join("\n")}\n</finding>`;
  });
  const recommendations = review.recommendations.map((recommendation) => `<recommendation>${textForPrompt(recommendation.text, REVIEW_TEXT_MAX_LENGTH)}</recommendation>`);
  const limits = review.limits_of_this_data.map((limit) => `<limit>${textForPrompt(limit, REVIEW_LIMIT_TEXT_MAX_LENGTH)}</limit>`);
  const opening = `<past_performance reviewed_on="${madeAt.toISOString().slice(0, 10)}" posts_from="${input.period.start.slice(0, 10)}" posts_to="${input.period.end.slice(0, 10)}" posts_with_numbers="${input.postCount}"${input.simulated ? ' simulated="yes"' : ""}>`;
  return [opening, ...findings, ...recommendations, ...limits, "</past_performance>"].join("\n");
}

// The review's input with each topic and name cut and hidden as its own
// request sent them, not escaped yet: each source is escaped whole above.
// WHY: the stored input keeps them whole for the company's own page, and a
// card number in a topic must reach the planner no more than the review.
function withTextsAsSent(input: ReviewInput): ReviewInput {
  return {
    ...input,
    posts: input.posts.map((post) => ({
      ...post,
      topic: redactedAndCut(post.topic, REVIEW_TOPIC_CHARACTERS),
      pillar: redactedAndCut(post.pillar, DRAFT_PILLAR_MAX_LENGTH),
    })),
    groups: input.groups.map((group) => ({ ...group, name: redactedAndCut(group.name, DRAFT_PILLAR_MAX_LENGTH) })),
  };
}
