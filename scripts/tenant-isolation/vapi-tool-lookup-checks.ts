// Knowledge lookup checks (step 35): each search the voice assistant makes
// during a call is recorded with article ids and a hit count only, and the
// call page lists them for the call's own company, an article deleted since
// as "deleted article"; an answer is given only once its lookup is saved.
// Also the one-line answer itself (buildCallAnswer), which "Test what the AI
// finds" shows too.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { recordKnowledgeLookup } from "@/db/knowledge-lookups";
import { createPhoneLine } from "@/db/phone-lines";
import { calls, knowledgeLookups } from "@/db/schema";
import { buildCallAnswer, CALL_ANSWER_MAX_CHARACTERS, CALL_ANSWER_PREFIX, NOTHING_FOUND_ANSWER } from "@/lib/knowledge/call-answer";
import { MAX_CALL_LOOKUPS_SHOWN } from "@/lib/knowledge/limits";
import { listKnowledgeLookupsForCallForSession } from "@/services/knowledge-lookups";
import { testKnowledgeSearchForSession } from "@/services/knowledge-search";
import { deleteKnowledgeArticleForSession } from "@/services/knowledge-status";
import { TOOL_CALL_ERRORS } from "@/services/vapi-tool-calls";
import { buildSampleEndOfCallReport } from "../vapi-sample";
import { assertRefusedByConstraint, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { approvedArticle } from "./knowledge-helpers";
import {
  countScheduledAnalyses,
  LIVE_TRANSCRIPT_PHRASE,
  postSignedToVapiWebhook,
  searchDuringCall,
  TOOL_CALLER_NUMBER,
  toolCallsMessage,
} from "./vapi-tool-helpers";

const word = `parcelix${runId}`;
const askedPhrase = `asked${runId}`;

async function lookupsOf(where: { companyId: string } | { vapiCallId: string }) {
  const condition = "companyId" in where ? eq(knowledgeLookups.companyId, where.companyId) : eq(knowledgeLookups.vapiCallId, where.vapiCallId);
  return db.select().from(knowledgeLookups).where(condition).orderBy(knowledgeLookups.createdAt);
}

// Makes Postgres refuse, while `run` runs, a lookup that found nothing under
// a call id starting with "refuse-lookup-": the only way to make one save
// fail on purpose (everything the webhook can send fits the table).
async function whileEmptyLookupsAreRefused<T>(run: () => Promise<T>): Promise<T> {
  await db.execute(sql`alter table knowledge_lookups drop constraint if exists refuse_lookups_for_checks`);
  await db.execute(
    sql`alter table knowledge_lookups add constraint refuse_lookups_for_checks check (hit_count > 0 or vapi_call_id not like 'refuse-lookup-%') not valid`,
  );
  try {
    return await run();
  } finally {
    await db.execute(sql`alter table knowledge_lookups drop constraint refuse_lookups_for_checks`);
  }
}

// Ends the call the way Vapi does, and returns our id for its saved row.
async function endCall(phoneNumberId: string, vapiCallId: string): Promise<string> {
  const analysesBefore = countScheduledAnalyses();
  const report = buildSampleEndOfCallReport({ callId: vapiCallId, phoneNumberId, callerNumber: TOOL_CALLER_NUMBER, transcript: "User: thanks" });
  assert.equal((await postSignedToVapiWebhook(report)).status, 200);
  assert.equal(countScheduledAnalyses(), analysesBefore + 1, "the call was not saved as new");
  const [row] = await db.select({ id: calls.id }).from(calls).where(eq(calls.vapiCallId, vapiCallId));
  return row.id;
}

export async function runVapiToolLookupChecks() {
  const ownerA = sessionFor(await signUpTestOwner("lookup-a"));
  const ownerB = sessionFor(await signUpTestOwner("lookup-b"));
  const lineA = (await createPhoneLine(ownerA.companyId, `pn-lookup-a-${runId}`)).vapiPhoneNumberId;
  const timesId = await approvedArticle(ownerA, { title: `Shipping times ${word}`, body: `We ship ${word} parcels within 2 days.` });
  const costsId = await approvedArticle(ownerA, { title: `Shipping costs ${word}`, body: `Sending a ${word} parcel costs 5 euros.` });
  const articleOfB = await approvedArticle(ownerB, { title: `B secret title ${word}`, body: `B's own ${word} text.` });

  await check("vapi tool: each search is recorded under the call's Vapi id with article ids and a hit count only, never the question or the live transcript", async () => {
    const vapiCallId = `call-lookup-${randomUUID()}`;
    await searchDuringCall(lineA, vapiCallId, `${word} shipping ${askedPhrase}`);
    await searchDuringCall(lineA, vapiCallId, `unheard-of ${askedPhrase}`);
    const rows = await lookupsOf({ vapiCallId });
    assert.equal(rows.length, 2);
    assert.deepEqual(Object.keys(rows[0]).sort(), ["articleIds", "companyId", "createdAt", "hitCount", "id", "vapiCallId"]);
    assert.deepEqual([rows[0].companyId, rows[0].hitCount, [...rows[0].articleIds].sort()], [ownerA.companyId, 2, [costsId, timesId].sort()]);
    assert.deepEqual([rows[1].hitCount, rows[1].articleIds], [0, []]);
    const stored = JSON.stringify(rows);
    for (const secret of [askedPhrase, LIVE_TRANSCRIPT_PHRASE, TOOL_CALLER_NUMBER, "twilio-secret-token", "We ship"]) {
      assert.ok(!stored.includes(secret), `"${secret}" was stored`);
    }
    // Without the call's id (Vapi always sends one) the answer is given, and nothing is recorded.
    const recordedBefore = (await lookupsOf({ companyId: ownerA.companyId })).length;
    const { message } = toolCallsMessage(lineA, vapiCallId, [{ arguments: { query: `${word} shipping` } }]);
    const withoutCallId = await postSignedToVapiWebhook({ message: { ...message, call: { phoneNumberId: lineA, id: null } } });
    assert.ok(String(withoutCallId.results?.[0].result).includes(`<article title="Shipping times ${word}">`), "no answer without the call's id");
    assert.equal((await lookupsOf({ companyId: ownerA.companyId })).length, recordedBefore);
  });

  await check("knowledge test: 'Test what the AI finds' shows the very line the phone assistant gets for the same question", async () => {
    const returnsWord = `tollix${runId}`;
    for (const day of ["one", "two", "three", "four"]) {
      await approvedArticle(ownerA, { title: `Returns ${returnsWord} day ${day}`, body: `Returns ${returnsWord} on day ${day}.` });
    }
    for (const question of [`${returnsWord} returns`, `${word} shipping`, "nothing like it"]) {
      const tested = await testKnowledgeSearchForSession(ownerA, { question });
      assert.ok(tested.ok, JSON.stringify(tested));
      const heard = await searchDuringCall(lineA, `call-lookup-test-${randomUUID()}`, question);
      assert.equal(tested.callAnswer, heard.result);
    }
    // Four pieces match: the page lists them all, the line holds the best 3.
    const four = await testKnowledgeSearchForSession(ownerA, { question: `${returnsWord} returns` });
    assert.ok(four.ok && four.slice.hits.length === 4 && four.callAnswer.split("</article>").length - 1 === 3, JSON.stringify(four));
  });

  await check("vapi tool: an answer is given only once its lookup is saved: a search whose save fails answers 'could not be searched' (still 200) with one class-only line, and the one before it stays answered and recorded", async () => {
    const vapiCallId = `refuse-lookup-${randomUUID()}`;
    const { message } = toolCallsMessage(lineA, vapiCallId, [{ arguments: { query: `${word} shipping` } }, { arguments: { query: "nothing like it" } }]);
    const answer = await whileEmptyLookupsAreRefused(() => postSignedToVapiWebhook({ message }));
    assert.equal(answer.status, 200);
    assert.ok(String(answer.results?.[0].result).includes(`<article title="Shipping times ${word}">`), JSON.stringify(answer.results?.[0]));
    assert.deepEqual(answer.results?.[1], { name: message.toolCallList[1].function.name, toolCallId: message.toolCallList[1].id, error: TOOL_CALL_ERRORS.failed });
    assert.equal(answer.logs.length, 1, answer.logs.join(" / "));
    assert.match(answer.logs[0], /^Vapi tool call failed: \w+$/);
    assert.deepEqual((await lookupsOf({ vapiCallId })).map((row) => row.hitCount), [2]);
  });

  await check("vapi tool: the call page lists what the call looked up, oldest first, for its own company only; a deleted article shows as deleted, another company's never by its title", async () => {
    const vapiCallId = `call-lookup-page-${randomUUID()}`;
    // During the call: its row doesn't exist yet.
    await searchDuringCall(lineA, vapiCallId, `${word} shipping`);
    await searchDuringCall(lineA, vapiCallId, "nothing like it");
    // Forged: B's lookup under A's call id, and A's naming B's article.
    await recordKnowledgeLookup(ownerB.companyId, { vapiCallId, articleIds: [articleOfB], hitCount: 1 });
    await recordKnowledgeLookup(ownerA.companyId, { vapiCallId, articleIds: [articleOfB], hitCount: 1 });
    const callId = await endCall(lineA, vapiCallId);
    assert.deepEqual(await deleteKnowledgeArticleForSession(ownerA, { articleId: costsId }), { ok: true });

    const page = await listKnowledgeLookupsForCallForSession(ownerA, callId);
    assert.equal(page.moreNotShown, false);
    const shown = page.lookups.map((lookup) => lookup.articles.map((article) => article.title ?? "deleted article").sort());
    assert.deepEqual(shown, [[`Shipping times ${word}`, "deleted article"], [], ["deleted article"]]);
    assert.ok(!JSON.stringify(page).includes("B secret title"), "another company's title was shown");
    assert.ok(page.lookups.every((lookup, index) => index === 0 || lookup.at >= page.lookups[index - 1].at), "not oldest first");
    assert.deepEqual(await listKnowledgeLookupsForCallForSession(ownerB, callId), { lookups: [], moreNotShown: false });
    assert.deepEqual(await listKnowledgeLookupsForCallForSession(ownerA, "not-a-call-id"), { lookups: [], moreNotShown: false });
  });

  await check(`vapi tool: the call page shows the first ${MAX_CALL_LOOKUPS_SHOWN} lookups of a call and says there are more`, async () => {
    const vapiCallId = `call-lookup-many-${randomUUID()}`;
    for (let index = 0; index <= MAX_CALL_LOOKUPS_SHOWN; index++) {
      await recordKnowledgeLookup(ownerA.companyId, { vapiCallId, articleIds: [timesId], hitCount: 1 });
    }
    const page = await listKnowledgeLookupsForCallForSession(ownerA, await endCall(lineA, vapiCallId));
    assert.deepEqual([page.lookups.length, page.moreNotShown], [MAX_CALL_LOOKUPS_SHOWN, true]);
  });

  await check("call answer: whole hits best first while they fit, at most 3, each article once; the first that doesn't fit has its text cut after a sentence or a word and marked, or is left out when little room is left", async () => {
    const hit = (articleId: string, title: string, text: string) => ({ articleId, title, text });
    const short = buildCallAnswer([hit("a1", "T\n1\u202E", "One."), hit("a1", "T1", "Two."), hit("a2", "T2", "Three."), hit("a3", "T3", "Four.")]);
    const shortText = `${CALL_ANSWER_PREFIX}<article title="T 1">One.</article> <article title="T1">Two.</article> <article title="T2">Three.</article>`;
    assert.deepEqual(short, { text: shortText, articleIds: ["a1", "a2"], hitCount: 3 });

    const cut = buildCallAnswer([hit("a1", "T1", "Short."), hit("a2", "T2", "A whole sentence here. ".repeat(80))]);
    assert.ok(cut.text.length <= CALL_ANSWER_MAX_CHARACTERS && cut.text.endsWith("here. ...</article>"), cut.text.slice(-30));
    assert.deepEqual([cut.articleIds, cut.hitCount], [["a1", "a2"], 2]);

    // About 140 characters left after the first: too little for a cut of the next hit.
    const firstText = "word ".repeat(400).slice(0, CALL_ANSWER_MAX_CHARACTERS - CALL_ANSWER_PREFIX.length - 200);
    const dropped = buildCallAnswer([hit("a1", "T1", firstText), hit("a2", "T2", "Never read. ".repeat(30))]);
    assert.deepEqual([dropped.articleIds, dropped.hitCount, dropped.text.includes("T2")], [["a1"], 1, false]);

    // Without spaces (Chinese, emoji) the text is cut at the limit, never at
    // an early space or sentence end, and never inside an emoji.
    for (const text of ["word ".repeat(400), "\u{1F600}".repeat(800), `OK. ${"退款需要五个工作日。".repeat(200)}`]) {
      const long = buildCallAnswer([hit("a1", "T1", text)]);
      assert.ok(long.text.endsWith(" ...</article>") && long.text.length <= CALL_ANSWER_MAX_CHARACTERS, `${long.text.length} characters`);
      assert.ok(long.text.length >= CALL_ANSWER_MAX_CHARACTERS - 10, `cut at ${long.text.length} characters`);
      assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(long.text), "an emoji was cut in half");
    }
    assert.deepEqual(buildCallAnswer([]), { text: NOTHING_FOUND_ANSWER, articleIds: [], hitCount: 0 });
  });

  await check("knowledge lookups: the database refuses more than 3 hits or more articles than hits, and the call page's read has its index", async () => {
    const vapiCallId = `call-lookup-db-${randomUUID()}`;
    await assertRefusedByConstraint(
      recordKnowledgeLookup(ownerA.companyId, { vapiCallId, articleIds: [], hitCount: 4 }),
      "knowledge_lookups_hit_count_range",
    );
    await assertRefusedByConstraint(
      recordKnowledgeLookup(ownerA.companyId, { vapiCallId, articleIds: [timesId, costsId], hitCount: 1 }),
      "knowledge_lookups_articles_within_hits",
    );
    const result = await db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where indexname = 'knowledge_lookups_company_id_vapi_call_id_created_at_idx'`,
    );
    assert.ok(result.rows[0]?.indexdef.includes("(company_id, vapi_call_id, created_at)"), "missing: run pnpm db:migrate");
  });
}
