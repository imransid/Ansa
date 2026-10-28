// Ops readiness checks (step 33), part 1: the hot queries' indexes exist, the
// database pool fails fast and survives Postgres closing a connection, a
// wrong setting names itself (never its value), production warns about risky
// settings and stand-in leftovers, and /api/health answers 200 or 503 only.
// Nothing here calls a real service.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import { Client } from "pg";
import { ZodError } from "zod";
import { db } from "@/db/client";
import { describeInvalidSettings, env, parseEnv } from "@/lib/env";
import { findProductionSettingProblems, findStandInLeftovers } from "@/lib/production-warnings";
import { handleHealthCheck } from "@/services/health";
import { captureConsole, check, runId } from "./helpers";

const ROOT = process.cwd();
const run = promisify(execFile);

// The index each hot query of step 33 needs, and what its definition holds.
const HOT_PATH_INDEXES: Record<string, string[]> = {
  inbound_emails_company_id_ticket_id_idx: ["(company_id, ticket_id)"],
  tickets_open_company_id_assignee_idx: ["(company_id, assigned_to_user_id, ticket_number)", "WHERE (status = 'open'"],
  tickets_open_company_id_ticket_number_idx: ["(company_id, ticket_number)", "WHERE (status = 'open'"],
  company_documents_company_id_created_at_idx: ["(company_id, created_at)"],
  calls_company_id_phone_line_id_created_at_idx: ["(company_id, phone_line_id, created_at)"],
  outgoing_emails_company_id_status_delivery_problem_idx: ["(company_id, status, delivery_problem)"],
};

// The fewest settings lib/env.ts accepts, all made up.
function validSettings(): Record<string, string> {
  return {
    DATABASE_URL: "postgres://x@localhost/x",
    BETTER_AUTH_SECRET: "s".repeat(32),
    BETTER_AUTH_URL: "http://localhost:3000",
    DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
    VAPI_WEBHOOK_SECRET: "v".repeat(32),
  };
}

function problemsWith(extra: Record<string, string>): string {
  return findProductionSettingProblems(parseEnv({ ...validSettings(), ...extra })).join("\n");
}

// Waits for `promise`, failing with `what` after `ms` milliseconds.
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not happen within ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Loads lib/env.ts in a fresh process with one setting changed, the way a
// server starting up does, and returns what it printed if it failed.
async function loadSettingsWith(name: string, value: string): Promise<{ failed: boolean; stderr: string }> {
  const tsx = path.join(ROOT, "node_modules", ".bin", "tsx");
  try {
    await run(tsx, ["--conditions=react-server", "-e", "import('./lib/env.ts')"], { cwd: ROOT, env: { ...process.env, [name]: value }, timeout: 60_000 });
    return { failed: false, stderr: "" };
  } catch (error) {
    return { failed: true, stderr: String((error as { stderr?: unknown }).stderr ?? "") };
  }
}

function healthRequest(caller: string): Request {
  return new Request("http://localhost/api/health", { headers: { "x-forwarded-for": caller } });
}

export async function runOpsReadinessChecks() {
  await check("indexes: every hot query of step 33 has its index (two of them over open tickets only)", async () => {
    const result = await db.execute<{ indexname: string; indexdef: string }>(sql`select indexname, indexdef from pg_indexes where schemaname = 'public'`);
    const definitions = new Map(result.rows.map((row) => [row.indexname, row.indexdef]));
    for (const [name, parts] of Object.entries(HOT_PATH_INDEXES)) {
      const definition = definitions.get(name);
      assert.ok(definition, `${name} is missing: run pnpm db:migrate`);
      for (const part of parts) {
        assert.ok(definition.includes(part), `${name}: ${definition}`);
      }
    }
  });

  await check("database pool: waits at most 10 s for a connection, and a connection Postgres ends is logged by class only, then replaced", async () => {
    const pool = db.$client;
    assert.deepEqual([pool.options.max, pool.options.idleTimeoutMillis, pool.options.connectionTimeoutMillis], [10, 10_000, 10_000]);
    // What Neon restarting looks like: Postgres ends a connection the pool holds idle.
    const { rows } = await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
    const killer = new Client({ connectionString: env.DATABASE_URL });
    await killer.connect();
    try {
      const { logs } = await captureConsole(async () => {
        const reported = new Promise<void>((resolve) => pool.once("error", () => resolve()));
        await killer.query("select pg_terminate_backend($1)", [rows[0].pid]);
        await within(reported, 10_000, "the pool's error event");
      });
      assert.deepEqual(logs, ["Database pool error: DatabaseError"]);
    } finally {
      await killer.end();
    }
    const { rows: after } = await db.execute<{ one: number }>(sql`select 1 as one`);
    assert.equal(after[0].one, 1);
  });

  await check("settings: a wrong one stops the server with one line naming the setting and the rule, never its value", async () => {
    const badKey = `not-a-key-${runId}`;
    let refused: unknown;
    try {
      parseEnv({ ...validSettings(), DATA_ENCRYPTION_KEY: badKey, VAPI_WEBHOOK_SECRET: `short-${runId}`, USE_STRIPE: `yes-${runId}`, DATABASE_URL: `nope ${runId}` });
    } catch (error) {
      refused = error;
    }
    assert.ok(refused instanceof ZodError, "the bad settings were accepted");
    const line = describeInvalidSettings(refused);
    for (const expected of ["DATA_ENCRYPTION_KEY: must be 32 bytes", "VAPI_WEBHOOK_SECRET: VAPI_WEBHOOK_SECRET must be at least 32", "USE_STRIPE: Invalid option", "DATABASE_URL: Invalid URL"]) {
      assert.ok(line.includes(expected), `${expected} is not in: ${line}`);
    }
    assert.ok(!line.includes(runId), line);
    // What a server starting with that key prints: lib/env.ts parses when first loaded.
    const started = await loadSettingsWith("DATA_ENCRYPTION_KEY", badKey);
    assert.equal(started.failed, true, "lib/env.ts loaded with a bad key");
    assert.match(started.stderr, /Invalid settings: DATA_ENCRYPTION_KEY: must be 32 bytes/);
    assert.ok(!started.stderr.includes(badKey), "the bad value was printed");
  });

  await check("production warnings: a Stripe test key, unsigned Vapi timestamps, a database address that isn't pooled or verify-full", async () => {
    const stripeOn = { USE_STRIPE: "true", STRIPE_WEBHOOK_SECRET: "whsec_x", STRIPE_PRICE_ID: "price_x" };
    assert.match(problemsWith({ ...stripeOn, STRIPE_SECRET_KEY: `sk_test_${runId}` }), /STRIPE_SECRET_KEY is a test key/);
    assert.match(problemsWith({ ...stripeOn, STRIPE_SECRET_KEY: `rk_test_${runId}` }), /STRIPE_SECRET_KEY is a test key/);
    assert.doesNotMatch(problemsWith({ ...stripeOn, STRIPE_SECRET_KEY: `sk_live_${runId}` }), /test key/);
    assert.match(problemsWith({ VAPI_SIGNATURE_PAYLOAD: "{body}" }), /VAPI_SIGNATURE_PAYLOAD is \{body\}/);
    assert.doesNotMatch(problemsWith({}), /VAPI_SIGNATURE_PAYLOAD/);
    const neon = (host: string, sslmode: string) => `postgres://neondb_owner:${runId}@${host}/neondb?sslmode=${sslmode}`;
    assert.doesNotMatch(problemsWith({ DATABASE_URL: neon("ep-calm-sun-a1b2-pooler.eu-central-1.aws.neon.tech", "verify-full") }), /DATABASE_URL/);
    const direct = problemsWith({ DATABASE_URL: neon("ep-calm-sun-a1b2.eu-central-1.aws.neon.tech", "require") });
    assert.match(direct, /DATABASE_URL's host has no -pooler/);
    assert.match(direct, /DATABASE_URL doesn't say sslmode=verify-full/);
    const everything = problemsWith({ ...stripeOn, STRIPE_SECRET_KEY: `sk_test_${runId}`, DATABASE_URL: neon(`ep-${runId}.aws.neon.tech`, "require") });
    assert.ok(!everything.includes(runId), "a warning holds a value");
  });

  await check("production warnings: stand-in folders still holding files once the real service is on, never while the stand-in is in use", async () => {
    const r2 = { USE_R2_STORAGE: "true", R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET: "d" };
    const realEmail = { SEND_REAL_EMAIL: "true", RESEND_API_KEY: "re_x", EMAIL_FROM: "support@example.com", INBOUND_EMAIL_DOMAIN: "inbound.example.com" };
    const realServices = parseEnv({ ...validSettings(), ...r2, ...realEmail });
    assert.deepEqual(findStandInLeftovers(realServices, () => false), []);
    const both = findStandInLeftovers(realServices, () => true).join("\n");
    assert.match(both, /\.dev-files\/ holds files saved while it was off/);
    assert.match(both, /\.dev-emails\/ holds emails written while it was off/);
    // The social stand-in is never in use in production (step 40): its folder warns whatever is set.
    assert.deepEqual(findStandInLeftovers(parseEnv(validSettings()), (folder) => folder !== ".dev-social"), [], "stand-ins in use warned");
    // The real folder test, on .dev-emails/ with a file of ours in it.
    const strayEmail = path.join(ROOT, ".dev-emails", `ops-readiness-${runId}.html`);
    await mkdir(path.dirname(strayEmail), { recursive: true });
    await writeFile(strayEmail, "x");
    try {
      assert.match(findStandInLeftovers(realServices).join("\n"), /\.dev-emails\/ holds emails/);
    } finally {
      await rm(strayEmail, { force: true });
    }
  });

  await check("health: 200 while the database answers, 503 when it doesn't, 429 for one address asking too often; never a body, never cached", async () => {
    const healthy = await handleHealthCheck(healthRequest(`health-${runId}-a`));
    assert.deepEqual([healthy.status, await healthy.text(), healthy.headers.get("cache-control")], [200, "", "no-store"]);
    const databaseDown = async () => {
      throw new Error(`connect ECONNREFUSED ${runId}`);
    };
    const down = await captureConsole(() => handleHealthCheck(healthRequest(`health-${runId}-b`), databaseDown));
    assert.deepEqual([down.result.status, await down.result.text()], [503, ""]);
    assert.equal(down.logs.length, 1);
    assert.match(down.logs[0], /^Health check failed: Error\n {4}at /);
    assert.ok(!down.logs[0].includes(runId), "the error's message was logged");
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 61; attempt++) {
      statuses.push((await handleHealthCheck(healthRequest(`health-${runId}-c`), async () => {})).status);
    }
    assert.ok(statuses.slice(0, 60).every((status) => status === 200), statuses.join(","));
    assert.equal(statuses[60], 429);
    assert.equal((await handleHealthCheck(healthRequest(`health-${runId}-d`))).status, 200, "another address was refused");
  });
}
