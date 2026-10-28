// Content text checks (step 38): a draft's texts are cleaned one way
// wherever they come from (lib/content-studio/draft-text.ts): at most 30
// combining marks in a row (a person's longer run is refused, the AI's cut),
// so checking the longest draft stays quick; a title or call to action
// keeps the joiners and flag tags writing needs; and the editor counts as
// unsaved exactly what a save would change. A FAKE model only: nothing
// calls Anthropic.

import assert from "node:assert/strict";
import { hasTooManyMarksInARow } from "@/lib/content-studio/draft-text";
import { editorValuesOf, sameEditorValues, type EditorValues } from "@/lib/content-studio/editor-values";
import { DRAFT_BODY_MAX_LENGTH } from "@/lib/content-studio/limits";
import { countXCharacters } from "@/lib/content-studio/x-length";
import type { SessionContext } from "@/lib/session";
import { editDraftForSession } from "@/services/content-draft-edits";
import { getContentDraftPageForSession } from "@/services/content-drafts";
import { messageOf, typeFact } from "./cofounder-helpers";
import { blankDraftId, draftAnswer, draftRow, editDraft, generatedDraftId, makeReadyForDrafts } from "./content-studio-helpers";
import { check, sessionFor, signUpTestOwner } from "./helpers";

// 30 combining marks in a row, the most a draft holds, in an order that
// normalizing must change (an accent above, then one below).
const THIRTY_MARKS = "\u0301\u0316".repeat(15);
const TOO_MANY_MARKS = /at most 30 can follow each other/;

// A woman cook (a woman, the zero-width joiner, a frying pan), a Persian
// word with its zero-width non-joiner, and Scotland's flag (a black flag
// and tag characters), written as escapes.
const WOMAN_COOK = "\u{1F469}\u200D\u{1F373}";
const PERSIAN_WORD = "\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645";
const SCOTLAND = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}";

// The editor's boxes for a draft as stored now, as its page opens them.
async function openedEditor(session: SessionContext, draftId: string): Promise<EditorValues> {
  const page = await getContentDraftPageForSession(session, draftId);
  assert.ok(page, "the draft's page can't be read");
  return editorValuesOf(page);
}

// Saves these boxes as the editor sends them, at the version stored now.
async function saveEditor(session: SessionContext, draftId: string, typed: EditorValues) {
  return editDraftForSession(session, { draftId, version: String((await draftRow(draftId)).version), ...typed });
}

export async function runContentTextChecks() {
  await check("content studio: a draft's texts hold at most 30 accents or other marks in a row (Unicode's bound for safe text; the half-width sound marks count too): a longer run typed in any box is refused, the AI's is cut to 30, and 30 are kept", async () => {
    const owner = sessionFor(await signUpTestOwner("studio-marks"));
    await makeReadyForDrafts(owner);
    const draftId = await blankDraftId(owner);
    const refused: Record<string, string>[] = [
      { body: `Cafe${THIRTY_MARKS}\u0301 bread` },
      { callToAction: `Come${THIRTY_MARKS}\u0316` },
      { topic: `Lunch${THIRTY_MARKS}\u0301` },
      { imagePrompt: `Bread${THIRTY_MARKS}\u0301` },
      { hashtags: `#bread${THIRTY_MARKS}\u0301` },
      // U+FF9E becomes a mark when the words to avoid are looked for (NFKC).
      { body: `\uFF71${"\uFF9E\u0301".repeat(16)}` },
      // Taking a zero-width space out of a line joins two runs into one too long.
      { callToAction: `Come${THIRTY_MARKS.slice(0, 20)}\u200B${THIRTY_MARKS.slice(0, 20)}` },
    ];
    for (const changes of refused) {
      assert.match(messageOf(await editDraft(owner, draftId, changes)), TOO_MANY_MARKS, JSON.stringify(changes).slice(0, 40));
    }
    assert.equal((await draftRow(draftId)).version, 1);
    const kept = { body: `Cafe${THIRTY_MARKS} bread`, callToAction: `Come${THIRTY_MARKS}` };
    assert.deepEqual(await editDraft(owner, draftId, kept), { ok: true });
    const saved = await draftRow(draftId);
    assert.deepEqual([saved.body, saved.callToAction], [kept.body, kept.callToAction]);

    // The AI's runs are cut to 30, never refused: the draft is saved.
    const longRun = `${THIRTY_MARKS}${"\u0301".repeat(40)}`;
    const answer = draftAnswer({ body: `Fresh${longRun} bread.`, call_to_action: `Come by${longRun}`, hashtags: [`bread${longRun}`] });
    const generated = await draftRow(await generatedDraftId(owner, undefined, answer));
    assert.deepEqual([generated.body, generated.callToAction], [`Fresh${THIRTY_MARKS} bread.`, `Come by${THIRTY_MARKS}`]);
    assert.ok(generated.hashtags.length === 1 && !hasTooManyMarksInARow(generated.hashtags[0]), JSON.stringify(generated.hashtags));
  });

  await check("content studio: the page's review of the longest text a person can save (63,206 characters of the longest runs of accents in the worst order), with 100 words to avoid, takes well under a second (a longer run took minutes)", async () => {
    const owner = sessionFor(await signUpTestOwner("studio-marks-time"));
    await makeReadyForDrafts(owner);
    const terms = Array.from({ length: 100 }, (_, index) => `w${index}x`);
    await typeFact(owner, "words_to_avoid", terms.join(", "));
    const draftId = await blankDraftId(owner, { platform: "facebook", format: "post", topic: "Long", pillar: "", campaign: "" });
    const body = `a${THIRTY_MARKS} `.repeat(Math.ceil(DRAFT_BODY_MAX_LENGTH / 32)).slice(0, DRAFT_BODY_MAX_LENGTH - 4) + " w7x";
    assert.equal(body.length, DRAFT_BODY_MAX_LENGTH);
    assert.deepEqual(await editDraft(owner, draftId, { body }), { ok: true });
    const started = performance.now();
    const page = await getContentDraftPageForSession(owner, draftId);
    const took = performance.now() - started;
    assert.deepEqual(page?.review.issues.map((issue) => issue.code), ["word_to_avoid"]);
    assert.ok(took < 1_000, `the page's review took ${Math.round(took)} ms`);
  });

  await check("content studio: a title or call to action keeps the joiners and flag tags writing needs (a woman cook emoji, a Persian word, Scotland's flag), typed or written by the AI, and loses the characters that hide or reorder text; X counts the joined emoji as 2", async () => {
    const owner = sessionFor(await signUpTestOwner("studio-joiners"));
    await makeReadyForDrafts(owner);
    const video = await blankDraftId(owner, { platform: "youtube", format: "video", topic: `Meet our baker ${WOMAN_COOK}`, pillar: "", campaign: "" });
    const typed = { title: `Our baker ${WOMAN_COOK} ${SCOTLAND}`, callToAction: `${PERSIAN_WORD} ${WOMAN_COOK}` };
    assert.deepEqual(await editDraft(owner, video, typed), { ok: true });
    const saved = await draftRow(video);
    assert.deepEqual([saved.topic, saved.title, saved.callToAction], [`Meet our baker ${WOMAN_COOK}`, typed.title, typed.callToAction]);
    // A right-to-left override and a zero-width space are taken out.
    assert.deepEqual(await editDraft(owner, video, { title: "Fresh\u202E bread\u200B today" }), { ok: true });
    assert.equal((await draftRow(video)).title, "Fresh bread today");

    const request = { platform: "youtube", format: "video", topic: "How we bake", pillar: "", campaign: "" };
    const answer = draftAnswer({ title: `How we bake ${WOMAN_COOK}`, call_to_action: `Meet our baker ${WOMAN_COOK} ${SCOTLAND}`, video_script: "Scene 1." });
    const generated = await draftRow(await generatedDraftId(owner, request, answer));
    assert.deepEqual([generated.title, generated.callToAction], [`How we bake ${WOMAN_COOK}`, `Meet our baker ${WOMAN_COOK} ${SCOTLAND}`]);
    // Without its joiner the emoji would be two, and count 4 on X.
    assert.deepEqual([countXCharacters(WOMAN_COOK), countXCharacters("\u{1F469}\u{1F373}")], [2, 4]);
  });

  await check("content studio: the editor counts as unsaved exactly what a save would change: spaces or line breaks at the ends, two spaces in a line or the same hashtags written another way save no new version, and the editor agrees; a real change or a bad hashtag is unsaved", async () => {
    const owner = sessionFor(await signUpTestOwner("studio-unsaved"));
    await makeReadyForDrafts(owner);
    const draftId = await generatedDraftId(owner);
    const opened = await openedEditor(owner, draftId);
    const nothingNew: Partial<EditorValues>[] = [
      { body: `${opened.body}\n` },
      { body: `  ${opened.body.replace("\n", "\r\n")} ` },
      { callToAction: ` ${opened.callToAction.replace(" ", "  ")}` },
      { topic: `${opened.topic}\n` },
      { hashtags: opened.hashtags.replace(" ", ",") },
      { hashtags: opened.hashtags.replaceAll("#", "") },
    ];
    for (const changes of nothingNew) {
      const typed = { ...opened, ...changes };
      assert.equal(sameEditorValues(typed, opened), true, JSON.stringify(changes));
      assert.deepEqual(await saveEditor(owner, draftId, typed), { ok: true });
      assert.equal((await draftRow(draftId)).version, 1, `a new version for ${JSON.stringify(changes)}`);
    }
    // A bad hashtag is a change: Save is there, and says why it can't save.
    const badHashtag = { ...opened, hashtags: `${opened.hashtags} #café-bar` };
    assert.equal(sameEditorValues(badHashtag, opened), false);
    assert.match(messageOf(await saveEditor(owner, draftId, badHashtag)), /Not a hashtag: #café-bar/);
    // A real change, a hashtag's spelling included, saves a new version.
    for (const changes of [{ body: `${opened.body} See you soon.` }, { hashtags: opened.hashtags.replace("Lisbon", "lisbon") }]) {
      const current = await openedEditor(owner, draftId);
      const typed = { ...current, ...changes };
      assert.equal(sameEditorValues(typed, current), false, JSON.stringify(changes));
      const before = (await draftRow(draftId)).version;
      assert.deepEqual(await saveEditor(owner, draftId, typed), { ok: true });
      assert.equal((await draftRow(draftId)).version, before + 1, JSON.stringify(changes));
    }
  });
}
