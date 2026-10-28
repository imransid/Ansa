import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

// The one database connection pool for the whole app.
// Only files inside /db (and Better Auth's adapter in lib/auth.ts) may import this.
//
// In production DATABASE_URL is Neon's POOLED address (its host has
// "-pooler", docs/going-live.md section 1): Neon's PgBouncer shares a few
// real Postgres connections between every server instance, so each instance
// can keep up to 10 of its own. There is no statement timeout here on
// purpose: PgBouncer refuses (or drops) settings sent when a connection
// opens, so the timeouts are set on the database role instead (same section).
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  // pg's own defaults, written down because they are a choice: at most 10
  // connections per server instance, each closed after 10 idle seconds.
  max: 10,
  idleTimeoutMillis: 10_000,
  // How long a query may wait for a connection: a free one when all 10 are
  // busy, or a new one while Postgres is slow to answer (Neon waking a
  // suspended database takes a second or two). Then it fails with an error.
  // Without a limit it would wait until the host kills the whole request.
  connectionTimeoutMillis: 10_000,
});

// An idle connection that Postgres closes (Neon restarting, a network reset)
// is reported here; the pool has already dropped it and opens a new one when
// needed. WHY a listener at all: without one, Node treats the report as an
// uncaught error, which stops a script (and, on some hosts, the server). The
// class name only, like every log line near call data (Rule 1).
pool.on("error", (error) => {
  console.error(`Database pool error: ${error.constructor.name}`);
});

export const db = drizzle({ client: pool, schema });

// The `tx` object Drizzle passes into db.transaction(async (tx) => ...).
// Functions that must run inside someone else's transaction take one of these.
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
