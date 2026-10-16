import "server-only";
import { z } from "zod";

// Fail fast at startup with a clear message instead of failing later
// with a confusing database or auth error.
const envSchema = z.object({
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url(),
});

export const env = envSchema.parse(process.env);
