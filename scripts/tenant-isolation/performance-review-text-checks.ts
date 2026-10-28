// Performance review checks (step 42), its texts: the numbers a finding
// writes are found in any script's digits (Persian ۴۰, Devanagari ४०, and
// full-width ４０ read as 40), so an invented one can't hide in them; and
// the next marketing plan gets each cited post's topic and pillar as the
// review's own request held them (card-like and social-security-like
// numbers hidden, cut to 200 characters), never the whole text the
// Analytics page shows the company. A stand-in for Claude only.

import assert from "node:assert/strict";
import { PERFORMANCE_REVIEW_SYSTEM_PROMPT } from "@/lib/performance-review/review-prompt";
import { numbersWrittenIn, writesOnlyAllowedNumbers } from "@/lib/performance-review/text-numbers";
import { getAnalyticsPageForSession } from "@/services/analytics-page";
import { reviewPerformanceForSession } from "@/services/performance-review";
import { simulated, standInPost } from "./analytics-helpers";
import { messageOf, modelAnswer, scriptedModel } from "./cofounder-helpers";
import { makeReadyForDrafts } from "./content-studio-helpers";
import { check, sessionFor, signUpTestOwner } from "./helpers";
import { makePlan } from "./marketing-plan-helpers";
import { postsWithNumbers } from "./performance-review-checks";

const LISBON = { period: "30", timeZone: "Europe/Lisbon" };

export async function runPerformanceReviewTextChecks() {
  await check("performance review: the numbers a text writes are found in any script's digits (full-width ones read as 0-9), so writing ۴۰٪ or ４０% uncited fails; a cited value counts only in 0-9 (the prompt asks for them), digits quoted from a cited topic as written", async () => {
    assert.deepEqual(numbersWrittenIn("بازدیدها ۴۰٪ و ٤٠ و ४० و ４０ و 1,234 at 09:00"), ["۴۰", "٤٠", "४०", "40", "1,234"]);
    assert.equal(writesOnlyAllowedNumbers("بازدیدهای لینکدین ۴۰٪ بیشتر شد.", [600], []), false);
    assert.equal(writesOnlyAllowedNumbers("Views rose ４０% on LinkedIn.", [600], []), false);
    assert.equal(writesOnlyAllowedNumbers("P5 got the most reactions (８).", [8], []), true);
    assert.equal(writesOnlyAllowedNumbers("P5 got the most reactions (۸).", [8], []), false);
    assert.equal(writesOnlyAllowedNumbers("P3, «۵ نان برتر», did well.", [6], ["۵ نان برتر"]), true);
    assert.match(PERFORMANCE_REVIEW_SYSTEM_PROMPT, /with every number in the digits 0-9/);
  });

  await check("performance review: the next marketing plan gets each cited post's topic and pillar as the review's own request held them (card-like and social-security-like numbers hidden, cut to 200 characters); the Analytics page still shows the company the whole topic", async () => {
    const owner = sessionFor(await signUpTestOwner("review-plan-secrets"));
    await makeReadyForDrafts(owner);
    await postsWithNumbers(owner, 4);
    const topic = `Card 4111 1111 1111 1111 refund story ${"and more ".repeat(40)}`.trim();
    const secret = await standInPost(owner, topic, { pillar: "Pillar 123-45-6789" });
    await simulated(secret, ["views=500", "reactions=20"]);
    // P5 is the newest post; G3 its pillar (G1 LinkedIn, G2 "Behind the oven").
    const evidence = [
      { post_label: "P5", group: "", metric: "reactions", value: 20 },
      { post_label: "", group: "G3", metric: "views_total", value: 500 },
    ];
    const review = scriptedModel([modelAnswer({ findings: [{ text: "P5 got the most reactions.", evidence }], recommendations: [], limits_of_this_data: [] })]);
    assert.deepEqual(await reviewPerformanceForSession(owner, LISBON, review.ask), { ok: true });
    const reviewPrompt = review.requests[0].prompt;
    const sentTopic = /<post label="P5" [^>]*>([^<]*)<\/post>/.exec(reviewPrompt)?.[1] ?? "";
    assert.match(sentTopic, /^Card \[number\] refund story and more .* \[\.\.\. \d+ characters left out \.\.\.\]$/, reviewPrompt);
    assert.match(reviewPrompt, /<group label="G3" kind="pillar" name="Pillar \[number\]" posts="1" /);

    const page = await getAnalyticsPageForSession(owner, {});
    assert.ok(page.review?.findings[0].evidence[0].source.startsWith(`P5: “${topic}”`), "the page lost the whole topic");

    const { result, model } = await makePlan(owner);
    assert.ok(result.ok, messageOf(result));
    const planPrompt = model.requests[0].prompt;
    assert.ok(planPrompt.includes(`<number source="P5: “${sentTopic}”, LinkedIn text post, `), planPrompt);
    assert.ok(planPrompt.includes('<number source="G3: pillar “Pillar [number]” (1 post)" metric="Views (all posts)" value="500"/>'), planPrompt);
    for (const secretPart of ["4111", "123-45-6789", "and more ".repeat(30)]) {
      assert.ok(!planPrompt.includes(secretPart), `the plan's request holds ${secretPart}`);
    }
  });
}
