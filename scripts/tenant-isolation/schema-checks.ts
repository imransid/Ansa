// Schema checks (step 43), on the database itself and the schema files: every
// tenant table has a company_id that is never empty; every foreign key from
// one tenant table to another names company_id first on both sides, so
// Postgres itself refuses a link across companies; every column pointing at
// a person has such a key to users; and the checks' cleanup empties every
// tenant table. There is no Row Level Security: these keys and /db's WHEREs
// are what keep companies apart (CLAUDE.md, architecture rules).

import assert from "node:assert/strict";
import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { check } from "./helpers";
import { read } from "./source-helpers";

// The tables that belong to no company: Better Auth's own, keyed by user,
// the rate limit counters (keyed by an HMAC) and the companies themselves.
const NOT_TENANT_TABLES = ["accounts", "companies", "rate_limits", "sessions", "verifications"];

type ForeignKey = { name: string; fromTable: string; toTable: string; fromColumns: string[]; toColumns: string[] };

async function tablesWithCompanyColumn(): Promise<{ table: string; companyIdNotNull: boolean | null }[]> {
  const result = await db.execute<{ table_name: string; company_id_not_null: boolean | null }>(sql`
    select c.relname as table_name,
      (select a.attnotnull from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped) as company_id_not_null
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'`);
  return result.rows.map((row) => ({ table: row.table_name, companyIdNotNull: row.company_id_not_null }));
}

async function foreignKeys(): Promise<ForeignKey[]> {
  const result = await db.execute<{ name: string; from_table: string; to_table: string; from_columns: string[]; to_columns: string[] }>(sql`
    select con.conname as name, con.conrelid::regclass::text as from_table, con.confrelid::regclass::text as to_table,
      (select array_agg(a.attname::text order by k.n) from unnest(con.conkey) with ordinality as k(attnum, n)
        join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as from_columns,
      (select array_agg(a.attname::text order by k.n) from unnest(con.confkey) with ordinality as k(attnum, n)
        join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum) as to_columns
    from pg_constraint con join pg_namespace n on n.oid = con.connamespace
    where con.contype = 'f' and n.nspname = 'public'`);
  return result.rows.map((row) => ({ name: row.name, fromTable: row.from_table, toTable: row.to_table, fromColumns: row.from_columns, toColumns: row.to_columns }));
}

async function userColumns(): Promise<{ table: string; column: string }[]> {
  const result = await db.execute<{ table_name: string; column_name: string }>(sql`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public' and column_name like '%user_id'`);
  return result.rows.map((row) => ({ table: row.table_name, column: row.column_name }));
}

export async function runSchemaChecks() {
  await check("schema: every tenant table has a company_id that is never empty, and every foreign key from one tenant table to another names company_id first on both sides (the companies table aside), so Postgres refuses a link across companies", async () => {
    const tables = await tablesWithCompanyColumn();
    const tenantTables = tables.filter((table) => !NOT_TENANT_TABLES.includes(table.table));
    assert.ok(tenantTables.length >= 28, `only ${tenantTables.length} tenant tables found`);
    for (const table of tenantTables) {
      assert.equal(table.companyIdNotNull, true, `${table.table} has no NOT NULL company_id`);
    }
    const tenantNames = new Set(tenantTables.map((table) => table.table));
    for (const key of await foreignKeys()) {
      if (!tenantNames.has(key.fromTable)) {
        continue;
      }
      if (key.toTable === "companies") {
        assert.deepEqual([key.fromColumns, key.toColumns], [["company_id"], ["id"]], key.name);
        continue;
      }
      assert.ok(tenantNames.has(key.toTable), `${key.name} points at ${key.toTable}, which belongs to no company`);
      assert.deepEqual([key.fromColumns[0], key.toColumns[0], key.fromColumns.length], ["company_id", "company_id", 2], `${key.name} doesn't keep the link within one company`);
    }
  });

  await check("schema: every column of a tenant table that points at a person has a same-company foreign key to users (company_id, id)", async () => {
    const keys = await foreignKeys();
    const columns = (await userColumns()).filter((column) => !NOT_TENANT_TABLES.includes(column.table));
    assert.ok(columns.length >= 30, `only ${columns.length} person columns found`);
    for (const { table, column } of columns) {
      const key = keys.find((candidate) => candidate.fromTable === table && candidate.toTable === "users" && candidate.fromColumns.join() === `company_id,${column}`);
      assert.ok(key, `${table}.${column} has no same-company foreign key`);
      assert.deepEqual(key.toColumns, ["company_id", "id"]);
    }
  });

  await check("schema: the tables in db/schema are the tables in the database, and the checks' cleanup empties every tenant table for the test companies", async () => {
    const declared = new Map<string, string>();
    for (const [exportName, value] of Object.entries(schema)) {
      if (is(value, PgTable)) {
        declared.set(getTableName(value), exportName);
      }
    }
    const inDatabase = (await tablesWithCompanyColumn()).map((table) => table.table).sort();
    assert.deepEqual([...declared.keys()].sort(), inDatabase);
    const cleanup = await read("scripts/tenant-isolation/cleanup.ts");
    for (const [table, exportName] of declared) {
      if (NOT_TENANT_TABLES.includes(table) || table === "users") {
        continue;
      }
      assert.ok(cleanup.includes(`db.delete(${exportName})`), `cleanup.ts never empties ${table}`);
    }
  });
}
