import "server-only";
import { z } from "zod";

// Fail fast at startup with a clear message instead of failing later
// with a confusing database, auth or email error.
const envSchema = z
  .object({
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    BETTER_AUTH_URL: z.url(),
    // Real email is OFF unless this is exactly "true". Off means emails are
    // written to .dev-emails/ instead of being sent. Values like "yes" or
    // "TRUE" are rejected so nobody turns it on (or off) by accident.
    SEND_REAL_EMAIL: z.enum(["true", "false"]).optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    // Plain address, e.g. support@yourdomain.com. The company name is added as
    // the display name when sending.
    EMAIL_FROM: z.email().optional(),
  })
  .superRefine((values, context) => {
    if (values.SEND_REAL_EMAIL !== "true") {
      return;
    }
    if (!values.RESEND_API_KEY) {
      context.addIssue({
        code: "custom",
        path: ["RESEND_API_KEY"],
        message: "RESEND_API_KEY is required when SEND_REAL_EMAIL=true",
      });
    }
    if (!values.EMAIL_FROM) {
      context.addIssue({
        code: "custom",
        path: ["EMAIL_FROM"],
        message: "EMAIL_FROM is required when SEND_REAL_EMAIL=true",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

// Exported so scripts/tenant-isolation can check the rules with fake values.
export function parseEnv(source: Record<string, string | undefined>): Env {
  return envSchema.parse(source);
}

export const env = parseEnv(process.env);
