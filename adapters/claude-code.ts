import "server-only";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ModelRequest, ModelResult } from "@/lib/model-request";

// DEVELOPMENT ONLY (step 49): asks Claude through Claude Code's command line
// (`claude -p`), on the Claude Code login of the computer ansa runs on, so
// the assistant can be tried without an API key. Anthropic doesn't allow a
// product to run on a claude.ai login: services/assistant-engine.ts never
// uses this in production. adapters/claude.ts is the way everywhere else.
//
// Locked down: no tools at all (no files, no shell, no web, no MCP), no
// settings, skills or CLAUDE.md files loaded, no session saved to disk, run
// in an empty folder of its own, with only the few environment variables a
// login needs (never ansa's secrets: no DATABASE_URL, no keys). The
// customer's conversation goes in on stdin, never on the command line.
// LOGGING RULE: nothing it prints is ever logged; failures are a name only.

export type ClaudeCodeOptions = {
  // The `claude` program: CLAUDE_CODE_PATH, else found on the PATH.
  binaryPath: string;
  model: string;
  effort: "low" | "medium" | "high";
  timeoutMs: number;
  // Only the checks pass these: a fake spawn (no program is ever run) and its environment.
  spawnFn?: SpawnFn;
  parentEnv?: NodeJS.ProcessEnv;
};

export type SpawnFn = (command: string, args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => ChildProcessWithoutNullStreams;

const spawnProgram: SpawnFn = (command, args, options) => spawn(command, args, options);

// The most the answer may be: a short JSON reply and Claude Code's details.
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
// Structured output takes Claude Code two turns (the answer, then its
// check); a few more leave room, and anything beyond is cut off.
const MAX_TURNS = "4";
// After asking it to stop, how long before it is stopped for sure.
const KILL_GRACE_MS = 5_000;

// The only variables passed on: where programs are, whose login it is, and
// switches that keep Claude Code from loading or sending anything else.
const PASSED_ON = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "TMPDIR"];
const LOCKED_DOWN = {
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
};

export async function askClaudeCode(request: ModelRequest, options: ClaudeCodeOptions): Promise<ModelResult> {
  if (request.image) {
    // Only adapters/claude.ts sends images (reading a menu photo).
    return { kind: "error", errorName: "ClaudeCodeNoImages" };
  }
  const workDir = await mkdtemp(path.join(tmpdir(), "ansa-claude-code-"));
  try {
    const run = await runClaudeCode(request.prompt, claudeCodeArguments(request, options), workDir, options);
    if (run.kind === "error") {
      return run;
    }
    return readClaudeCodeResult(run.output);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

// The command line: one prompt, JSON out in the request's schema, and
// nothing Claude Code would otherwise load or allow.
export function claudeCodeArguments(request: ModelRequest, options: Pick<ClaudeCodeOptions, "model" | "effort">): string[] {
  return [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(request.jsonSchema),
    "--system-prompt",
    request.systemPrompt,
    "--tools",
    "",
    "--strict-mcp-config",
    "--disallowedTools",
    "mcp__*",
    "--setting-sources",
    "",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--max-turns",
    MAX_TURNS,
    "--model",
    options.model,
    "--effort",
    options.effort,
  ];
}

// The environment Claude Code runs with: PASSED_ON from ansa's own, and the
// switches above. Nothing else of ansa's settings reaches it.
export function claudeCodeEnvironment(parentEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: parentEnv.NODE_ENV, ...LOCKED_DOWN };
  for (const name of PASSED_ON) {
    const value = parentEnv[name];
    if (value) {
      environment[name] = value;
    }
  }
  return environment;
}

type RunOutcome = { kind: "done"; output: string } | { kind: "error"; errorName: string };

// Runs the program once: the prompt on stdin, its answer read from stdout
// (capped), cut off after timeoutMs. Never throws.
function runClaudeCode(prompt: string, args: string[], workDir: string, options: ClaudeCodeOptions): Promise<RunOutcome> {
  const spawnFn = options.spawnFn ?? spawnProgram;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: RunOutcome) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(outcome);
      }
    };
    const child = spawnFn(options.binaryPath, args, { cwd: workDir, env: claudeCodeEnvironment(options.parentEnv ?? process.env) });
    const chunks: Buffer[] = [];
    let size = 0;
    const stop = (errorName: string) => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref();
      finish({ kind: "error", errorName });
    };
    const timer = setTimeout(() => stop("ClaudeCodeTimeout"), options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) {
        stop("ClaudeCodeOutputTooLarge");
        return;
      }
      chunks.push(chunk);
    });
    // Read and dropped: what it prints there is never kept.
    child.stderr.on("data", () => undefined);
    child.on("error", (error: NodeJS.ErrnoException) => finish({ kind: "error", errorName: error.code === "ENOENT" ? "ClaudeCodeNotFound" : "ClaudeCodeError" }));
    child.on("close", (code: number | null) => {
      finish(code === 0 ? { kind: "done", output: Buffer.concat(chunks).toString("utf8") } : { kind: "error", errorName: "ClaudeCodeFailed" });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(prompt);
  });
}

// What `claude -p --output-format json` printed, as a ModelResult: the
// answer is its structured_output (the request's schema), whole.
export function readClaudeCodeResult(output: string): ModelResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return { kind: "error", errorName: "ClaudeCodeUnreadable" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { kind: "error", errorName: "ClaudeCodeUnreadable" };
  }
  const result = parsed as { subtype?: unknown; is_error?: unknown; structured_output?: unknown; usage?: { input_tokens?: unknown; output_tokens?: unknown } };
  if (result.subtype === "error_max_turns") {
    return { kind: "truncated" };
  }
  if (result.is_error === true || result.subtype !== "success") {
    return { kind: "error", errorName: "ClaudeCodeError" };
  }
  if (typeof result.structured_output !== "object" || result.structured_output === null) {
    // Claude declined, or ended without the answer the schema asks for.
    return { kind: "unexpected-stop" };
  }
  return {
    kind: "ok",
    outputText: JSON.stringify(result.structured_output),
    usage: { inputTokens: tokenCount(result.usage?.input_tokens), outputTokens: tokenCount(result.usage?.output_tokens) },
  };
}

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
