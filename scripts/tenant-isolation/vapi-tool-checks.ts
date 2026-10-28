// Vapi tool checks (step 35): during a live call the voice assistant's
// search_company_knowledge answers, through the real signed webhook, with
// the approved support articles of the company that owns the phone line and
// nothing else; every answer is HTTP 200, one line and bounded; odd calls get
// error entries; the per-company limit refuses with error entries; and
// nothing of the query, the answer or the live transcript is logged.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { createPhoneLine } from "@/db/phone-lines";
import { knowledgeLookups } from "@/db/schema";
import { CALL_ANSWER_MAX_CHARACTERS, CALL_ANSWER_PREFIX, NOTHING_FOUND_ANSWER } from "@/lib/knowledge/call-answer";
import { KNOWLEDGE_TOOL_NAME } from "@/lib/validation/vapi-tool-calls";
import { getVapiSignatureSettings, signLikeVapi } from "@/lib/vapi-signature";
import { archiveKnowledgeArticleForSession } from "@/services/knowledge-status";
import { isOverRateLimit, RATE_LIMITS } from "@/services/rate-limit";
import { TOOL_CALL_ERRORS } from "@/services/vapi-tool-calls";
import { check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { approvedArticle, writeArticle } from "./knowledge-helpers";
import {
  LIVE_TRANSCRIPT_PHRASE,
  postSignedToVapiWebhook,
  postToVapiWebhook,
  searchDuringCall,
  TOOL_CALLER_NUMBER,
  toolCallsMessage,
  toolCheckLogs,
} from "./vapi-tool-helpers";

// A word only this run's articles hold, and the question a caller asks with it.
const word = `zorblat${runId}`;
const question = `how long does a ${word} refund take`;
const articleTextPhrase = `refund-text-${runId}`;

// One line: no line breaks of any kind, and no other control characters.
const LINE_BREAK_OR_CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]/u;

async function lookupsRecordedFor(vapiCallId: string) {
  return db.select().from(knowledgeLookups).where(eq(knowledgeLookups.vapiCallId, vapiCallId));
}

export async function runVapiToolChecks() {
  const ownerA = sessionFor(await signUpTestOwner("tool-a"));
  const ownerB = sessionFor(await signUpTestOwner("tool-b"));
  const lineA = (await createPhoneLine(ownerA.companyId, `pn-tool-a-${runId}`)).vapiPhoneNumberId;
  const lineB = (await createPhoneLine(ownerB.companyId, `pn-tool-b-${runId}`)).vapiPhoneNumberId;
  await approvedArticle(ownerA, { title: `A refunds ${word}`, body: `A ${word} refund takes 5 business days. ${articleTextPhrase}.` });
  await writeArticle(ownerA, { title: `A draft ${word}`, body: `A draft about ${word} refunds.` });
  const archivedId = await approvedArticle(ownerA, { title: `A archived ${word}`, body: `An old ${word} refund rule.` });
  assert.deepEqual(await archiveKnowledgeArticleForSession(ownerA, { articleId: archivedId }), { ok: true });
  await approvedArticle(ownerA, { title: `A marketing ${word}`, body: `Our ${word} refund promise.`, support: false, marketing: true });
  await approvedArticle(ownerB, { title: `B refunds ${word}`, body: `B's ${word} refund takes 30 days.` });

  await check("vapi tool: a signed search on company A's line answers with A's approved support articles only (never B's, drafts, archived or marketing-only)", async () => {
    const toolCallId = `toolu_${randomUUID()}`;
    const answer = await postSignedToVapiWebhook(toolCallsMessage(lineA, `call-tool-${randomUUID()}`, [{ id: toolCallId, arguments: { query: question } }]));
    assert.equal(answer.status, 200);
    assert.match(answer.contentType ?? "", /^application\/json/);
    assert.equal(answer.results?.length, 1);
    const [entry] = answer.results;
    assert.deepEqual(Object.keys(entry).sort(), ["name", "result", "toolCallId"]);
    assert.deepEqual([entry.name, entry.toolCallId], [KNOWLEDGE_TOOL_NAME, toolCallId]);
    const result = String(entry.result);
    assert.ok(result.includes(`<article title="A refunds ${word}">A ${word} refund takes 5 business days.`), "A's approved article is missing");
    for (const other of ["A draft", "A archived", "A marketing", "B refunds"]) {
      assert.ok(!result.includes(other), `${other} was in the answer`);
    }
    const resultForB = String((await searchDuringCall(lineB, `call-tool-${randomUUID()}`, question)).result);
    assert.ok(resultForB.includes(`<article title="B refunds ${word}">`) && !resultForB.includes("A refunds"), "B's line got the wrong articles");
  });

  await check("vapi tool: arguments as an object and as a JSON string give the same answer", async () => {
    const asObject = await postSignedToVapiWebhook(toolCallsMessage(lineA, `call-tool-${randomUUID()}`, [{ arguments: { query: question } }]));
    const asString = await postSignedToVapiWebhook(toolCallsMessage(lineA, `call-tool-${randomUUID()}`, [{ arguments: JSON.stringify({ query: question }) }]));
    assert.ok(String(asObject.results?.[0].result).includes("A refunds"));
    assert.equal(asString.results?.[0].result, asObject.results?.[0].result);
  });

  await check("vapi tool: an unknown tool, bad arguments and an unknown or missing line answer error entries with HTTP 200, search nothing and record nothing", async () => {
    const callId = `call-tool-errors-${randomUUID()}`;
    const oddCalls = [
      { name: "transferCall", arguments: { query: question }, expected: TOOL_CALL_ERRORS.unknownTool },
      { arguments: {}, expected: TOOL_CALL_ERRORS.badArguments },
      { arguments: { query: " \n\t " }, expected: TOOL_CALL_ERRORS.badArguments },
      { arguments: { query: "x".repeat(501) }, expected: TOOL_CALL_ERRORS.badArguments },
      { arguments: "not json", expected: TOOL_CALL_ERRORS.badArguments },
      { arguments: '{"query": 5}', expected: TOOL_CALL_ERRORS.badArguments },
      { arguments: 42, expected: TOOL_CALL_ERRORS.badArguments },
    ].map((toolCall) => ({ ...toolCall, id: `toolu_${randomUUID()}` }));
    const answer = await postSignedToVapiWebhook(toolCallsMessage(lineA, callId, oddCalls));
    assert.equal(answer.status, 200);
    assert.deepEqual(
      answer.results,
      oddCalls.map((toolCall) => ({ name: toolCall.name ?? KNOWLEDGE_TOOL_NAME, toolCallId: toolCall.id, error: toolCall.expected })),
    );
    assert.equal((await lookupsRecordedFor(callId)).length, 0, "a refused tool call was recorded");

    // A line nobody linked, a web call (no line), and the nulls Vapi may send for missing fields.
    for (const call of [{ id: callId, phoneNumberId: `pn-unknown-${runId}` }, { id: callId }, { id: callId, phoneNumberId: null }, null]) {
      const toolCallId = `toolu_${randomUUID()}`;
      const { message } = toolCallsMessage(lineA, callId, [{ id: toolCallId, arguments: { query: question } }]);
      const unknown = await postSignedToVapiWebhook({ message: { ...message, call } });
      assert.equal(unknown.status, 200);
      assert.deepEqual(unknown.results, [{ name: KNOWLEDGE_TOOL_NAME, toolCallId, error: TOOL_CALL_ERRORS.notSetUp }]);
      assert.deepEqual(unknown.logs, ["Vapi tool call ignored: unknown phone line"]);
    }
    assert.equal((await lookupsRecordedFor(callId)).length, 0, "a call on an unknown line was recorded");
  });

  await check("vapi tool: unsigned, wrongly signed and stale tool calls get 401 as before, with no answer, and record nothing", async () => {
    const callId = `call-tool-unsigned-${randomUUID()}`;
    const bytes = Buffer.from(JSON.stringify(toolCallsMessage(lineA, callId, [{ arguments: { query: question } }])), "utf8");
    const settings = getVapiSignatureSettings();
    const attempts = [
      await postToVapiWebhook(bytes, {}),
      await postToVapiWebhook(bytes, signLikeVapi(bytes, { ...settings, secret: "x".repeat(40) }, new Date())),
      await postToVapiWebhook(bytes, signLikeVapi(bytes, settings, new Date(Date.now() - 10 * 60 * 1000))),
    ];
    for (const attempt of attempts) {
      assert.deepEqual([attempt.status, attempt.text, attempt.logs], [401, "", ["Vapi webhook rejected: invalid signature"]]);
    }
    assert.equal((await lookupsRecordedFor(callId)).length, 0);
  });

  await check("vapi tool: every answer is one line of at most 1,500 characters, best first, a hit too long cut and marked", async () => {
    const longWord = `quoxium${runId}`;
    const paragraph = `The ${longWord} setup has many steps.\nStep one is\tthis. `.repeat(30);
    await approvedArticle(ownerA, { title: `Long guide ${longWord}`, body: [paragraph, paragraph, paragraph].join("\n\n") });
    const callId = `call-tool-long-${randomUUID()}`;
    const answer = await postSignedToVapiWebhook(
      toolCallsMessage(lineA, callId, [{ arguments: { query: `${longWord} setup` } }, { arguments: { query: question } }, { arguments: { query: "nothing like it" } }]),
    );
    assert.equal(answer.results?.length, 3);
    for (const entry of answer.results ?? []) {
      for (const value of Object.values(entry)) {
        assert.ok(!LINE_BREAK_OR_CONTROL.test(String(value)), `a line break in ${String(value).slice(0, 30)}`);
      }
      assert.ok(String(entry.result).length <= CALL_ANSWER_MAX_CHARACTERS, `${String(entry.result).length} characters`);
    }
    const longResult = String(answer.results?.[0].result);
    assert.ok(longResult.startsWith(`${CALL_ANSWER_PREFIX}<article title="Long guide ${longWord}">The ${longWord} setup`), longResult.slice(0, 240));
    assert.match(longResult, /(steps|this)\. \.\.\.<\/article>$/, `not cut after a sentence: ${longResult.slice(-30)}`);
    assert.ok(longResult.length > 1_000, "the best hit was cut far shorter than the room left");
  });

  await check("vapi tool: no match answers plainly that the knowledge base has nothing, so the assistant offers a ticket", async () => {
    for (const query of [`unheard-of ${randomUUID()}`, "how do I", "???"]) {
      assert.equal((await searchDuringCall(lineA, `call-tool-${randomUUID()}`, query)).result, NOTHING_FOUND_ANSWER);
    }
  });

  await check("vapi tool: a malformed tool-calls message answers 200 with no results and one fixed line; an entry without an id is left out", async () => {
    const notAList = toolCallsMessage(lineA, `call-tool-${randomUUID()}`, []);
    const tooMany = toolCallsMessage(lineA, `call-tool-${randomUUID()}`, Array.from({ length: 11 }, () => ({ arguments: { query: question } })));
    for (const body of [{ message: { ...notAList.message, toolCallList: "search" } }, tooMany]) {
      const answer = await postSignedToVapiWebhook(body);
      assert.deepEqual([answer.status, answer.text, answer.logs], [200, '{"results":[]}', ["Vapi tool call rejected: invalid tool-calls message"]]);
    }
    const withOdd = toolCallsMessage(lineA, `call-tool-${randomUUID()}`, [{ arguments: { query: question } }]);
    const toolCallList = [{ type: "function", function: { name: KNOWLEDGE_TOOL_NAME } }, "odd", ...withOdd.message.toolCallList];
    const answer = await postSignedToVapiWebhook({ message: { ...withOdd.message, toolCallList } });
    assert.deepEqual(answer.results?.map((entry) => entry.toolCallId), [withOdd.message.toolCallList[0].id]);
  });

  await check("vapi tool: the per-company limit refuses with error entries (still 200) and one fixed line, and other companies keep searching", async () => {
    const busy = sessionFor(await signUpTestOwner("tool-busy"));
    const busyLine = (await createPhoneLine(busy.companyId, `pn-tool-busy-${runId}`)).vapiPhoneNumberId;
    for (let index = 0; index < RATE_LIMITS.knowledgeLookupsPerCompany.maxAttempts; index++) {
      await isOverRateLimit("knowledge-lookups", busy.companyId, RATE_LIMITS.knowledgeLookupsPerCompany);
    }
    const callId = `call-tool-busy-${randomUUID()}`;
    const answer = await postSignedToVapiWebhook(toolCallsMessage(busyLine, callId, [{ arguments: { query: question } }, { arguments: { query: "shipping" } }]));
    assert.equal(answer.status, 200);
    assert.deepEqual(answer.results?.map((entry) => entry.error), [TOOL_CALL_ERRORS.rateLimited, TOOL_CALL_ERRORS.rateLimited]);
    assert.deepEqual(answer.logs, ["Vapi tool call refused: rate limited"]);
    assert.equal((await lookupsRecordedFor(callId)).length, 0);
    assert.ok(String((await searchDuringCall(lineA, `call-tool-${randomUUID()}`, question)).result).includes("A refunds"));
  });

  await check("vapi tool: nothing of the query, the answer, the live transcript, the caller or the phone provider reaches the logs", async () => {
    assert.ok(toolCheckLogs.length > 0, "nothing was captured");
    const secrets = [word, articleTextPhrase, LIVE_TRANSCRIPT_PHRASE, TOOL_CALLER_NUMBER, "twilio-secret-token", "live-recording", "refund"];
    for (const line of toolCheckLogs) {
      for (const secret of secrets) {
        assert.ok(!line.includes(secret), `"${secret}" in a log line`);
      }
    }
  });
}
