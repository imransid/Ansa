import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

// A phone number column with everything but its digits removed, so numbers
// written differently ("+1 (555) 010-0199", "+15550100199") compare equal.
// The JavaScript side is lib/phone-number.ts. A NULL number stays NULL, so it
// never matches anything.
export function phoneDigitsOf(column: PgColumn): SQL {
  return sql`regexp_replace(${column}, '[^0-9]', '', 'g')`;
}
