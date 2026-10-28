import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Counts attempts per action + caller (for example "login" + IP address).
// Not tenant data, so no company_id: limits apply before we know who you are.
// The key is an HMAC-SHA256 made with a server secret (services/rate-limit.ts),
// so the IP address or email can't be read back from it, not even by guessing.
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  attemptCount: integer("attempt_count").notNull(),
  windowStartedAt: timestamp("window_started_at", {
    withTimezone: true,
  }).notNull(),
});
