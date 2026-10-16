import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

// The one database connection pool for the whole app.
// Only files inside /db (and Better Auth's adapter in lib/auth.ts) may import this.
export const db = drizzle(env.DATABASE_URL, { schema });
