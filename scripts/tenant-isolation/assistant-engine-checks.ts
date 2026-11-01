// Assistant checks (step 49), part two: Claude Code (development only) runs
// locked down, with a fake program, never the real one; a restaurant's own
// API key is stored encrypted and never shown back; production never uses
// Claude Code; the hourly limits; "Test your assistant" saves and sends
// nothing; a Telegram customer gets the reply through the restaurant's
// account, and a handover alerts the owner in Telegram too.

import assert from "node:assert/strict";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { eq } from "drizzle-orm";
import { askClaudeCode, claudeCodeArguments, claudeCodeEnvironment, readClaudeCodeResult, type SpawnFn } from "@/adapters/claude-code";
import { db } from "@/db/client";
import { assistantSettings, conversations } from "@/db/schema";
import { ASSISTANT_ANSWER_JSON_SCHEMA } from "@/lib/assistant/answer";
import { assistantAskerFor, getEngineState } from "@/services/assistant-engine";
import { saveAiEngineForSession } from "@/services/assistant-engine-settings";
import { testAssistantForSession } from "@/services/assistant-test";
import { isOverRateLimit, RATE_LIMITS } from "@/services/rate-limit";
import { addTeammate, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { answer, assistantMessages, customerWrites, fakeModel, HOLDING_REPLY, setUpRestaurant } from "./assistant-check-helpers";
import { businessConnection, businessMessage, connectCodeFor, connectionId, fakeTelegram, postUpdate, REAL_MODE, startMessage, telegramId } from "./telegram-check-helpers";

const REQUEST = { systemPrompt: "The rules", prompt: "Customer: secret question", jsonSchema: ASSISTANT_ANSWER_JSON_SCHEMA };

// A fake `claude` program: records how it was started and what it read,
// and prints `output` (or never answers, or isn't installed).
function fakeProgram(behaviour: { output?: string; hang?: boolean; missing?: boolean }) {
  const runs: { command: string; args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv; stdin: string; killed: boolean }[] = [];
  const spawnFn: SpawnFn = (command, args, options) => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
    const run = { command, args, cwd: options.cwd, env: options.env, stdin: "", killed: false };
    runs.push(run);
    child.kill = () => {
      run.killed = true;
      setImmediate(() => child.emit("close", null));
      return true;
    };
    child.stdin.on("data", (chunk: Buffer) => (run.stdin += chunk.toString()));
    setImmediate(() => {
      if (behaviour.missing) {
        child.emit("error", Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }));
      } else if (!behaviour.hang) {
        child.stdout.end(behaviour.output ?? "");
        child.emit("close", 0);
      }
    });
    return child as unknown as ChildProcessWithoutNullStreams;
  };
  return { spawnFn, runs };
}

export async function runAssistantEngineChecks() {
  await check("assistant engine: Claude Code runs locked down (no tools, settings, MCP or saved session, ansa's secrets kept out, the conversation on stdin), and its answer, failure, timeout or absence is read", async () => {
    const args = claudeCodeArguments(REQUEST, { model: "claude-sonnet-5-5", effort: "low" });
    for (const [flag, value] of [["--tools", ""], ["--setting-sources", ""], ["--disallowedTools", "mcp__*"], ["--output-format", "json"], ["--system-prompt", "The rules"]]) {
      assert.equal(args[args.indexOf(flag) + 1], value, flag);
    }
    assert.ok(args.includes("--strict-mcp-config") && args.includes("--no-session-persistence") && args.includes("--disable-slash-commands"));
    assert.ok(!args.some((arg) => arg.includes("secret question")), "the conversation went on the command line");
    const env = claudeCodeEnvironment({ ...process.env, DATABASE_URL: "postgres://x", ANTHROPIC_API_KEY: "sk-ant-x", PATH: "/usr/bin", HOME: "/Users/x" });
    const allowed = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "TMPDIR", "NODE_ENV"];
    assert.deepEqual(Object.keys(env).filter((name) => !name.startsWith("CLAUDE_CODE_") && !allowed.includes(name)), []);
    assert.deepEqual([env.PATH, env.HOME, env.DATABASE_URL, env.ANTHROPIC_API_KEY, env.CLAUDE_CODE_DISABLE_CLAUDE_MDS], ["/usr/bin", "/Users/x", undefined, undefined, "1"]);
    const options = { binaryPath: "claude", model: "claude-sonnet-5-5", effort: "low" as const, timeoutMs: 2_000 };
    const ok = fakeProgram({ output: JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: { action: "no_reply" }, usage: { input_tokens: 5, output_tokens: 2 } }) });
    assert.deepEqual(await askClaudeCode(REQUEST, { ...options, spawnFn: ok.spawnFn }), { kind: "ok", outputText: '{"action":"no_reply"}', usage: { inputTokens: 5, outputTokens: 2 } });
    assert.equal(ok.runs[0].stdin, "Customer: secret question");
    assert.equal(ok.runs[0].env.DATABASE_URL, undefined);
    const hung = fakeProgram({ hang: true });
    assert.deepEqual(await askClaudeCode(REQUEST, { ...options, timeoutMs: 50, spawnFn: hung.spawnFn }), { kind: "error", errorName: "ClaudeCodeTimeout" });
    assert.ok(hung.runs[0].killed);
    assert.deepEqual(await askClaudeCode(REQUEST, { ...options, spawnFn: fakeProgram({ missing: true }).spawnFn }), { kind: "error", errorName: "ClaudeCodeNotFound" });
    assert.deepEqual(readClaudeCodeResult(JSON.stringify({ subtype: "success", is_error: true })), { kind: "error", errorName: "ClaudeCodeError" });
    assert.deepEqual(readClaudeCodeResult(JSON.stringify({ subtype: "success", is_error: false })), { kind: "unexpected-stop" });
    assert.deepEqual(await askClaudeCode({ ...REQUEST, image: { mediaType: "image/png", base64: "x" } }, options), { kind: "error", errorName: "ClaudeCodeNoImages" });
  });

  await check("assistant engine: an owner's API key is stored encrypted, shown only as its last four, removable; a member can't change the engine; production never uses Claude Code", async () => {
    const owner = await signUpTestOwner("assistant-engine");
    const member = await addTeammate(owner, "assistant-engine-member", "member");
    const key = "sk-ant-api03-CHECKonlyNeverRealKey000000000000wxyz";
    assert.deepEqual(await saveAiEngineForSession(sessionFor(owner), { engine: "api_key", apiKey: key }), { ok: true });
    const [stored] = await db.select().from(assistantSettings).where(eq(assistantSettings.companyId, owner.companyId));
    assert.ok(stored.anthropicKeyEncrypted && !stored.anthropicKeyEncrypted.includes("CHECKonly"));
    assert.deepEqual([stored.anthropicKeyHint, (await getEngineState(owner.companyId)).keySource], ["wxyz", "restaurant"]);
    assert.ok(await assistantAskerFor(owner.companyId), "the saved key made no engine");
    assert.equal((await saveAiEngineForSession(sessionFor(owner), { engine: "api_key", apiKey: "not-a-key" })).ok, false);
    assert.equal((await saveAiEngineForSession(sessionFor(member), { engine: "claude_code" })).ok, false);
    assert.equal((await saveAiEngineForSession(sessionFor(owner), { engine: "claude_code" }, "production")).ok, false);
    assert.deepEqual(await saveAiEngineForSession(sessionFor(owner), { engine: "claude_code", removeKey: "on" }), { ok: true });
    assert.equal((await getEngineState(owner.companyId)).keyHint, null);
    assert.equal(await assistantAskerFor(owner.companyId, "production"), null);
    assert.ok(await assistantAskerFor(owner.companyId, "development"));
  });

  await check("assistant engine: past a customer's hourly limit the assistant stays quiet; past the restaurant's it hands over; 'Test your assistant' answers without saving or sending anything", async () => {
    const owner = await signUpTestOwner("assistant-limits");
    await setUpRestaurant(owner);
    const model = fakeModel(answer({ reply: "Hello!" }));
    const first = await customerWrites(owner, "Lou", "Hi", model.asker);
    for (let count = 0; count < RATE_LIMITS.assistantRepliesPerCustomer.maxAttempts; count++) {
      await isOverRateLimit("assistant-customer", first.turn.conversationId, RATE_LIMITS.assistantRepliesPerCustomer);
    }
    assert.equal((await customerWrites(owner, "Lou", "Hi again", model.asker)).outcome, "quiet");
    for (let count = 0; count < RATE_LIMITS.assistantRepliesPerCompany.maxAttempts; count++) {
      await isOverRateLimit("assistant-replies", owner.companyId, RATE_LIMITS.assistantRepliesPerCompany);
    }
    const limited = await customerWrites(owner, "Max", "Hi", model.asker);
    assert.equal(limited.outcome, "handed-over");
    assert.ok((await assistantMessages(owner, limited.turn.conversationId))[0].text?.endsWith(HOLDING_REPLY));
    // The test box: a reply, a handover, a member refused; nothing saved.
    const tester = await signUpTestOwner("assistant-test-box");
    await setUpRestaurant(tester);
    const reply = await testAssistantForSession(sessionFor(tester), { text: "Open tonight?" }, fakeModel(answer({ reply: "Yes!" })).asker);
    assert.deepEqual(reply, { ok: true, outcome: "reply", text: `I'm the AI assistant for Isolation test assistant-test-box ${runId}.\nYes!` });
    const handover = await testAssistantForSession(sessionFor(tester), { text: "Refund!" }, fakeModel(answer({ action: "needs_person", handover_reason: "refund" })).asker);
    assert.ok(handover.ok && handover.outcome === "handover" && handover.why === "They asked for a refund or compensation.");
    const member = await addTeammate(tester, "assistant-test-member", "member");
    assert.equal((await testAssistantForSession(sessionFor(member), { text: "Hi" }, null)).ok, false);
    assert.equal((await db.select().from(conversations).where(eq(conversations.companyId, tester.companyId))).length, 0);
  });

  await check("assistant engine: a Telegram customer's message is answered through the restaurant's account after the webhook's answer; a handover alerts the owner in Telegram", async () => {
    const owner = await signUpTestOwner("assistant-telegram");
    await setUpRestaurant(owner);
    const accountUser = telegramId();
    const externalId = connectionId("assistant");
    await postUpdate(startMessage(accountUser, `/start ${await connectCodeFor(owner)}`));
    await postUpdate(businessConnection(externalId, accountUser));
    const customer = telegramId();
    const telegram = fakeTelegram();
    const delivery = { telegramMode: REAL_MODE, fetchFn: telegram.fetchFn };
    await postUpdate(businessMessage(externalId, customer, customer, { text: "Open tonight?" }), {
      assistant: { asker: fakeModel(answer({ reply: "Yes, until 23:00." })).asker, settleMs: 0, delivery },
    });
    await postUpdate(businessMessage(externalId, customer, customer, { text: "It was cold last time" }), {
      assistant: { asker: fakeModel(answer({ action: "needs_person", handover_reason: "complaint" })).asker, settleMs: 0, delivery, alerts: delivery },
    });
    const sent = telegram.requests.map((request) => [request.body.chat_id, request.body.business_connection_id ?? null, String(request.body.text).split("\n").at(-1)]);
    assert.deepEqual(sent.slice(0, 2), [
      [String(customer), externalId, "Yes, until 23:00."],
      [String(customer), externalId, HOLDING_REPLY],
    ]);
    assert.equal(sent[2][0], String(accountUser));
    assert.match(String(sent[2][2]), /needs you on Telegram\. They complained\./);
  });
}
