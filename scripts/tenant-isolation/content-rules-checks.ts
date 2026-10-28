// Content rules checks (step 38), on the pure rules themselves
// (lib/content-rules.ts and lib/content-studio/): X's length counted as X
// counts it, YouTube's video-only rules, the hashtag cap, the words to
// avoid, the other platforms' limits and required media, the live counts,
// where the feed cuts a text, and how hashtags are read. No database.

import assert from "node:assert/strict";
import { checkContentRules, type ContentIssueCode, type DraftContent } from "@/lib/content-rules";
import { measureDraftContent } from "@/lib/content-studio/content-measures";
import { cutForFeed } from "@/lib/content-studio/feed-preview";
import { cleanModelHashtags, readTypedHashtags } from "@/lib/content-studio/hashtags";
import { DRAFT_BODY_MAX_LENGTH } from "@/lib/content-studio/limits";
import { measureText } from "@/lib/content-studio/text-measure";
import { findWordsToAvoid, readWordsToAvoid } from "@/lib/content-studio/words-to-avoid";
import { countXCharacters } from "@/lib/content-studio/x-length";
import { newDraftSchema } from "@/lib/validation/content-drafts";
import { check } from "./helpers";

// A draft's content for the rules; `overrides` replaces fields.
function content(overrides: Partial<DraftContent> = {}): DraftContent {
  return { platform: "linkedin", format: "post", title: "", body: "Fresh bread.", hashtags: [], callToAction: "", videoScript: "", ...overrides };
}

// The issue codes the rules give, with their severity.
function issuesOf(draft: DraftContent, wordsToAvoid: string[] = []): string[] {
  return checkContentRules(draft, { media: null, wordsToAvoid }).map((issue) => `${issue.code}:${issue.severity}`);
}

function has(draft: DraftContent, code: ContentIssueCode, wordsToAvoid: string[] = []): boolean {
  return checkContentRules(draft, { media: null, wordsToAvoid }).some((issue) => issue.code === code);
}

// How many times `run` normalizes a text of more than 1,000 characters
// (String.prototype.normalize, watched while it runs).
function countLongNormalizations(run: () => void): number {
  const original = String.prototype.normalize;
  let count = 0;
  String.prototype.normalize = function (this: string, form?: string) {
    if (this.length > 1_000) {
      count += 1;
    }
    return original.call(this, form);
  };
  try {
    run();
  } finally {
    String.prototype.normalize = original;
  }
  return count;
}

export async function runContentRulesChecks() {
  await check("content rules: X counts as X does: 280 letters fit and 281 don't, a Chinese or Japanese character counts 2, an emoji 2 (a family or a flag too), a link 23 whatever its length", async () => {
    assert.deepEqual(issuesOf(content({ platform: "x", body: "a".repeat(280) })), []);
    assert.deepEqual(issuesOf(content({ platform: "x", body: "a".repeat(281) })), ["text_too_long:blocking"]);
    assert.deepEqual([countXCharacters("日本"), countXCharacters("é"), countXCharacters("é"), countXCharacters("Ωж")], [4, 1, 1, 2]);
    assert.equal(has(content({ platform: "x", body: "日".repeat(140) }), "text_too_long"), false);
    assert.equal(has(content({ platform: "x", body: "日".repeat(141) }), "text_too_long"), true);
    for (const emoji of ["👍", "👍🏽", "👨\u200D👩\u200D👧", "🇵🇹", "❤️"]) {
      assert.equal(countXCharacters(emoji), 2, emoji);
    }
    assert.equal(countXCharacters(`https://example.test/${"a".repeat(200)}`), 23);
    assert.deepEqual([countXCharacters("see https://x.test/a."), countXCharacters("www.example.test")], [4 + 23 + 1, 23]);
    // The call to action and the hashtags count too, each as its own paragraph.
    const nearlyFull = content({ platform: "x", body: "a".repeat(260), hashtags: ["one", "two"] });
    assert.equal(measureText("a".repeat(260) + "\n\n#one #two", "x"), 271);
    assert.equal(has(nearlyFull, "text_too_long"), false);
    assert.equal(has({ ...nearlyFull, callToAction: "Come by today!" }, "text_too_long"), true);
  });

  await check("content rules: YouTube takes videos only, each needing its video, a title of at most 100 characters and no < or >; its description counts bytes", async () => {
    const video = content({ platform: "youtube", format: "video", title: "How we bake", body: "Every morning." });
    assert.deepEqual(issuesOf(video), ["media_missing:blocking"]);
    assert.deepEqual(issuesOf({ ...video, format: "post" }), ["format_not_accepted:blocking"]);
    assert.ok(issuesOf({ ...video, title: "  " }).includes("title_missing:blocking"));
    assert.ok(issuesOf({ ...video, title: "a".repeat(101) }).includes("title_too_long:blocking"));
    assert.ok(!issuesOf({ ...video, title: "a".repeat(100) }).includes("title_too_long:blocking"));
    assert.ok(issuesOf({ ...video, title: "Bread <3" }).includes("angle_brackets:blocking"));
    assert.ok(issuesOf({ ...video, body: "a > b" }).includes("angle_brackets:blocking"));
    assert.ok(!has({ ...video, body: "a".repeat(5_000) }, "text_too_long"));
    // 2,501 accented letters are 5,002 bytes.
    assert.ok(has({ ...video, body: "é".repeat(2_501) }, "text_too_long"));
    // "New draft" refuses the pair before anything is saved.
    const youTubePost = newDraftSchema.safeParse({ platform: "youtube", format: "post", topic: "Bread" });
    assert.equal(youTubePost.success, false);
    assert.deepEqual(youTubePost.error?.issues.map((issue) => issue.path), [["format"]]);
    assert.equal(newDraftSchema.safeParse({ platform: "youtube", format: "video", topic: "Bread" }).success, true);
  });

  await check("content rules: at most 10 hashtags on every platform (blocking), X warns above 2, and every platform takes text posts but YouTube; an image post and a video need their media", async () => {
    const tags = (count: number) => Array.from({ length: count }, (_, index) => `tag${index}`);
    for (const platform of ["linkedin", "facebook", "x"] as const) {
      assert.equal(has(content({ platform, hashtags: tags(10) }), "too_many_hashtags"), false, platform);
      assert.deepEqual(
        issuesOf(content({ platform, hashtags: tags(11) })).filter((issue) => issue.includes("hashtags")),
        ["too_many_hashtags:blocking"],
        platform,
      );
    }
    assert.deepEqual(issuesOf(content({ platform: "x", hashtags: tags(3) })), ["many_hashtags:warning"]);
    assert.deepEqual(issuesOf(content({ platform: "x", hashtags: tags(2) })), []);
    assert.deepEqual(issuesOf(content({ platform: "linkedin", hashtags: tags(3) })), []);
    assert.deepEqual(issuesOf(content({ format: "image_post" })), ["media_missing:blocking"]);
    assert.deepEqual(issuesOf(content({ format: "video" })), ["media_missing:blocking"]);
    assert.deepEqual(checkContentRules(content({ format: "image_post" }), { media: { kind: "image", altText: "" }, wordsToAvoid: [] }), []);
    assert.deepEqual(issuesOf(content({ body: "  " })), ["text_missing:blocking"]);
  });

  await check("content rules: LinkedIn takes 3,000 characters and Facebook 63,206; the live counts are the rules' own counts", async () => {
    assert.equal(has(content({ body: "a".repeat(3_000) }), "text_too_long"), false);
    assert.equal(has(content({ body: "a".repeat(3_001) }), "text_too_long"), true);
    assert.equal(has(content({ platform: "facebook", body: "a".repeat(63_206) }), "text_too_long"), false);
    assert.equal(has(content({ platform: "facebook", body: "a".repeat(63_207) }), "text_too_long"), true);
    const xPost = content({ platform: "x", body: `Menu: https://bakery.test/${"m".repeat(80)}`, hashtags: ["bread"] });
    const [text, hashtags] = measureDraftContent(xPost);
    assert.deepEqual([text.label, text.used, text.max, text.over, hashtags.used, hashtags.max], ["Post text", 6 + 23 + 2 + 6, 280, false, 1, 10]);
    const youTube = measureDraftContent(content({ platform: "youtube", format: "video", title: "Hello", body: "é" }));
    assert.deepEqual(youTube.map((measure) => [measure.label, measure.used, measure.unit]), [
      ["Title", 5, "characters"],
      ["Description", 2, "bytes"],
      ["Hashtags", 0, ""],
    ]);
  });

  await check("words to avoid: read from the fact at commas, semicolons and lines, matched as whole words or phrases in any case, in the text, the title, the hashtags, the call to action and the script; 'None.' lists nothing", async () => {
    assert.deepEqual(readWordsToAvoid('cheap, discount; Best in town.\n- "guaranteed"\n1. x'), ["cheap", "discount", "Best in town", "guaranteed"]);
    assert.deepEqual([readWordsToAvoid("None."), readWordsToAvoid(null), readWordsToAvoid("n/a")], [[], [], []]);
    assert.deepEqual(findWordsToAvoid("Cheap! Really #cheap.", ["cheap"]), ["cheap"]);
    assert.deepEqual(findWordsToAvoid("Our cheapest loaf, carefree", ["cheap", "free"]), []);
    assert.deepEqual(findWordsToAvoid("the BEST   in\ntown", ["best in town"]), ["best in town"]);
    assert.deepEqual(findWordsToAvoid("ｃｈｅａｐ bread", ["cheap"]), ["cheap"]);
    assert.deepEqual(findWordsToAvoid("a+b (c)", ["a+b", "(c)"]), ["a+b", "(c)"]);
    const words = ["cheap", "guaranteed"];
    const inCallToAction = checkContentRules(content({ callToAction: "Cheap lunch today" }), { media: null, wordsToAvoid: words });
    assert.deepEqual(inCallToAction.map((issue) => [issue.code, issue.severity]), [["word_to_avoid", "blocking"]]);
    assert.match(inCallToAction[0].message, /"cheap" is on your Words to avoid list .* in the post text\./);
    assert.ok(has(content({ hashtags: ["Guaranteed"] }), "word_to_avoid", words));
    const video = content({ platform: "youtube", format: "video", title: "Cheap bread", body: "", videoScript: "It is guaranteed." });
    const videoIssues = checkContentRules(video, { media: { kind: "video", altText: "" }, wordsToAvoid: words }).map((issue) => issue.message);
    assert.ok(videoIssues.some((message) => message.includes('"cheap"') && message.includes("in the title")));
    assert.ok(videoIssues.some((message) => message.includes('"guaranteed"') && message.includes("in the video script")));
    assert.deepEqual(issuesOf(content({ body: "Fresh bread, cheaply made" }), words), []);
    // The alt text of its image or video is published with it (step 39).
    const imagePost = content({ format: "image_post" });
    const inAltText = checkContentRules(imagePost, { media: { kind: "image", altText: "Cheap loaves, 50% off" }, wordsToAvoid: words });
    assert.deepEqual(inAltText.map((issue) => [issue.code, issue.severity]), [["word_to_avoid", "blocking"]]);
    assert.match(inAltText[0].message, /"cheap" is on your Words to avoid list .* in the image's alt text \(media library\)\./);
    assert.deepEqual(checkContentRules(imagePost, { media: { kind: "image", altText: "Our cheapest loaves" }, wordsToAvoid: words }), []);
  });

  await check("content rules: checking a long draft reads each text a fixed number of times, never once per word to avoid (100 words cost no more passes than 1), and X's count of a 63,206-character link takes linear time", async () => {
    const draft = content({ platform: "facebook", body: `${"Fresh bread every morning. ".repeat(2_000)}w7x`, videoScript: "Scene. ".repeat(1_400) });
    const oneWord = countLongNormalizations(() => checkContentRules(draft, { media: null, wordsToAvoid: ["w7x"] }));
    const words = Array.from({ length: 100 }, (_, index) => `w${index}x`);
    const hundredWords = countLongNormalizations(() => checkContentRules(draft, { media: null, wordsToAvoid: words }));
    assert.ok(oneWord > 0 && oneWord <= 5, `${oneWord} passes`);
    assert.equal(hundredWords, oneWord);
    assert.ok(has(draft, "word_to_avoid", words));

    // A run of dots inside a link once took seconds to strip from its end.
    const longLink = `https://${".".repeat(DRAFT_BODY_MAX_LENGTH - 9)}a`;
    assert.equal(longLink.length, DRAFT_BODY_MAX_LENGTH);
    const started = performance.now();
    assert.equal(countXCharacters(longLink), 23);
    assert.ok(performance.now() - started < 500, `counting took ${Math.round(performance.now() - started)} ms`);
    assert.deepEqual([countXCharacters("https://x.test/a...!"), countXCharacters(`see ${longLink}...`)], [23 + 4, 4 + 23 + 3]);
  });

  await check("feed preview: LinkedIn cuts after about 210 characters or 3 lines behind '...see more', at a word; X never cuts; a short text stays whole", async () => {
    const long = `${"bread ".repeat(60)}end`;
    const cut = cutForFeed("linkedin", long);
    assert.equal(cut.moreLabel, "...see more");
    assert.ok(cut.shown.length <= 210 && cut.shown.length > 160 && cut.shown.endsWith("bread"), cut.shown);
    assert.deepEqual(cutForFeed("linkedin", "one\ntwo\nthree\nfour"), { shown: "one\ntwo\nthree", moreLabel: "...see more" });
    assert.deepEqual(cutForFeed("x", long), { shown: long, moreLabel: null });
    assert.deepEqual(cutForFeed("facebook", "Fresh bread."), { shown: "Fresh bread.", moreLabel: null });
    assert.equal(cutForFeed("youtube", long).moreLabel, "...more");
  });

  await check("hashtags: typed with or without #, by spaces or commas, each once whatever its case; a word that can't be one is named; the AI's are cleaned, never refused", async () => {
    assert.deepEqual(readTypedHashtags("#bread, lisbon  #Bread café_bar"), { hashtags: ["bread", "lisbon", "café_bar"], invalid: [] });
    assert.deepEqual(readTypedHashtags("#café-bar #123 ok #"), { hashtags: ["ok"], invalid: ["#café-bar", "#123"] });
    assert.deepEqual(cleanModelHashtags(["#Sour Dough", "x-y", "ok", "OK", "#2026"]), ["SourDough", "ok"]);
    assert.equal(cleanModelHashtags(Array.from({ length: 40 }, (_, index) => `tag${index}`)).length, 30);
  });
}
