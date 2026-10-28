import "server-only";
import { sql } from "drizzle-orm";
import { db } from "./client";

// Asks the database the smallest possible question, "select 1", for the
// health check (services/health.ts). It reads no table, so there is no
// company to filter by. Throws when the database doesn't answer.
export async function pingDatabase(): Promise<void> {
  await db.execute(sql`select 1`);
}
