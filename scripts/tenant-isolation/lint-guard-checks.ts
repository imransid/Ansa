// Lint guard checks (step 26): with no Row Level Security, the ESLint rules
// that keep queries inside /db are the only automatic guard, so they must not
// be easy to step around. Relative and absolute paths, any spelling of a /db
// path other than "@/db/<file>" (".", "..", "//", an extension), import() and
// require() of /db, loading modules at run time (createRequire, module.require,
// a require kept in a variable), Better Auth's $context (its raw adapter
// reads every company's users) outside lib/auth.ts and
// lib/password-reset-links.ts, components/ or lib/ importing a /db function,
// lib/auth.ts importing more than the client and schema, and .js files are
// all errors, while what the app really does (services importing /db, lib
// importing @/db/schema, lib/auth.ts handing the client to Better Auth, the
// reset-link lookup) still passes.
// Runs the project's own eslint.config.mjs.

import assert from "node:assert/strict";
import path from "node:path";
import { ESLint } from "eslint";
import { check } from "./helpers";

const GUARD_RULES = ["no-restricted-imports", "no-restricted-syntax"];

// The guard rules' messages for a snippet linted as if it were the file at
// this path (the file doesn't have to exist).
async function guardErrors(eslint: ESLint, filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((message) => GUARD_RULES.includes(message.ruleId ?? "")).map((message) => message.message);
}

// The raw client by its absolute path. TypeScript resolves it, like every odd
// spelling of a /db path below, so each one must be a lint error.
const ABSOLUTE_CLIENT_PATH = path.join(process.cwd(), "db", "client");

const WAYS_AROUND: [string, string][] = [
  ["services/probe.ts", 'import { db } from "../db/client";\nexport const x = db;'],
  ["app/probe.ts", 'import { getTicketsForCompany } from "../db/tickets";\nexport const x = getTicketsForCompany;'],
  ["app/nested/probe.ts", 'import { getTicketsForCompany } from "../../db/tickets";\nexport const x = getTicketsForCompany;'],
  ["services/probe.ts", `import { db } from "${ABSOLUTE_CLIENT_PATH}";\nexport const x = db;`],
  ["services/probe.ts", 'import { db } from "@/db/./client";\nexport const x = db;'],
  ["services/probe.ts", 'import { db } from "@/db//client";\nexport const x = db;'],
  ["services/probe.ts", 'import { db } from "@//db/client";\nexport const x = db;'],
  ["services/probe.ts", 'import { db } from "@/db/client.js";\nexport const x = db;'],
  ["services/probe.ts", 'import { db } from "@/lib/../db/client";\nexport const x = db;'],
  ["app/probe.ts", 'import { db } from "@/lib/../db/client";\nexport const x = db;'],
  ["components/probe.tsx", 'import { getTicketsForCompany } from "@/components/../db/tickets";\nexport const x = getTicketsForCompany;'],
  ["services/probe.ts", 'export async function load() {\n  return import("drizzle-orm");\n}'],
  ["services/probe.ts", 'export async function load() {\n  return import("@/db/client");\n}'],
  ["app/probe.ts", 'export async function load() {\n  return import("@/db/tickets");\n}'],
  ["services/probe.ts", 'const where = "@/db/client";\nexport async function load() {\n  return import(where);\n}'],
  ["services/probe.ts", "export const client = require(`@/db/client`);"],
  ["components/probe.tsx", 'import { getTicketsForCompany } from "@/db/tickets";\nexport const x = getTicketsForCompany;'],
  ["lib/probe.ts", 'import { getTicketsForCompany } from "@/db/tickets";\nexport const x = getTicketsForCompany;'],
  ["lib/probe.ts", 'import { db } from "@/db/client";\nexport const x = db;'],
  ["lib/auth.ts", 'import { getTicketsForCompany } from "@/db/tickets";\nexport const x = getTicketsForCompany;'],
  ["lib/auth.ts", 'import { sql } from "drizzle-orm";\nexport const x = sql;'],
  ["lib/auth.ts", 'export async function load() {\n  return import("@/db/tickets");\n}'],
  ["services/probe.js", 'import { drizzle } from "drizzle-orm/node-postgres";\nexport const x = drizzle;'],
  ["services/probe.cjs", 'const { Pool } = require("pg");\nmodule.exports = Pool;'],
  ["services/probe.mjs", 'import pg from "pg";\nexport default pg;'],
  // Loading a module at run time, by a name the rules never see.
  ["services/probe.ts", 'import { createRequire } from "node:module";\nconst load = createRequire(import.meta.url);\nexport const { Pool } = load("pg");'],
  ["services/probe.ts", 'import * as nodeModule from "module";\nexport const load = nodeModule["createRe" + "quire"];'],
  ["services/probe.ts", 'export const load = process.getBuiltinModule("module").createRequire(import.meta.url);'],
  ["services/probe.ts", 'const load = require;\nexport const { Pool } = load("pg");'],
  ["services/probe.ts", 'export const { Pool } = module.require("pg");'],
  ["app/probe.ts", 'export async function load() {\n  return import("node:module");\n}'],
  // Better Auth's raw adapter: the users table with no company filter.
  ["services/probe.ts", 'import { auth } from "@/lib/auth";\nexport async function everyone() {\n  return (await auth.$context).adapter.findMany({ model: "user" });\n}'],
  ["services/probe.ts", 'import { auth } from "@/lib/auth";\nexport async function move(id: string) {\n  const context = await auth["$context"];\n  return context.internalAdapter.updateUser(id, { companyId: "x" });\n}'],
  ["app/probe.ts", 'import { auth } from "@/lib/auth";\nexport async function everyone() {\n  const { $context } = auth;\n  return (await $context).adapter;\n}'],
  ["services/probe.ts", 'import { auth } from "@/lib/auth";\nexport async function everyone() {\n  const { "$context": context } = auth;\n  return (await context).adapter;\n}'],
  ["services/probe.ts", 'import { auth } from "@/lib/auth";\nexport async function everyone() {\n  const { ["$context"]: context } = auth;\n  return (await context).adapter;\n}'],
  ["services/probe.ts", 'import { auth } from "@/lib/auth";\nexport async function everyone() {\n  return (await Reflect.get(auth, "$context")).adapter;\n}'],
  ["services/probe.ts", 'import { auth } from "@/lib/auth";\nexport async function everyone() {\n  return (await auth[`$context`]).adapter;\n}'],
  ["services/probe.ts", 'export function users(context: Record<string, unknown>) {\n  const { "internalAdapter": adapter } = context;\n  return adapter;\n}'],
  ["lib/probe.ts", 'import { auth } from "@/lib/auth";\nexport async function find(id: string) {\n  return (await auth.$context).internalAdapter.findUserById(id);\n}'],
];

const REAL_USES: [string, string][] = [
  ["services/probe.ts", 'import { getTicketsForCompany } from "@/db/tickets";\nexport const x = getTicketsForCompany;'],
  ["lib/probe.ts", 'import { userRoles, type UserRole } from "@/db/schema";\nexport const x: readonly UserRole[] = userRoles;'],
  ["lib/auth.ts", 'import { db } from "@/db/client";\nimport * as schema from "@/db/schema";\nexport const x = [db, schema];'],
  ["lib/password-reset-links.ts", 'import { auth } from "@/lib/auth";\nexport async function find(token: string) {\n  return (await auth.$context).internalAdapter.findVerificationValue(token);\n}'],
  ["instrumentation-probe.ts", 'export async function load() {\n  return import("./lib/safe-error-logging");\n}'],
];

export async function runLintGuardChecks() {
  const eslint = new ESLint({ cwd: process.cwd() });

  await check("lint: every way around the /db rule is an error (relative, absolute and odd @/db paths, import(), require(), createRequire, a require kept in a variable, Better Auth's $context, components/, lib/, lib/auth.ts, .js files)", async () => {
    for (const [filePath, code] of WAYS_AROUND) {
      assert.ok((await guardErrors(eslint, filePath, code)).length > 0, `not flagged in ${filePath}:\n${code}`);
    }
  });

  await check("lint: what the app really does still passes (services use /db functions, lib uses @/db/schema, lib/auth.ts the client)", async () => {
    for (const [filePath, code] of REAL_USES) {
      assert.deepEqual(await guardErrors(eslint, filePath, code), [], `flagged in ${filePath}:\n${code}`);
    }
  });
}
