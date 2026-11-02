import "server-only";
import { z } from "zod";

// The screens' settings. The screens hold no database address, encryption
// key or service secret: every rule and every outside service lives in core
// (core/.env.core.example), the AI in the brain. Fail fast at startup with
// one line naming each wrong setting and the rule it breaks, never its value.
const envSchema = z.object({
  // Core's private address, e.g. http://127.0.0.1:8080.
  CORE_API_URL: z.url(),
  // Signs every request the screens send core: the same value in core's settings.
  SCREENS_SHARED_SECRET: z.string().min(32, "SCREENS_SHARED_SECRET must be at least 32 characters (openssl rand -hex 32)"),
  // The screens' own public address, e.g. https://app.example.com (robots.txt,
  // the sitemap, and whether a cookie must be https-only).
  APP_URL: z.url(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

// Exported so a check can try the rules with fake values.
export function parseEnv(source: Record<string, string | undefined>): Env {
  return envSchema.parse(source);
}

// One line naming each wrong setting and the rule it breaks, never its value
// (Zod's messages describe the rule, not what was given).
export function describeInvalidSettings(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "settings"}: ${issue.message}`).join("; ");
}

export const env = parseEnvAtStartup(process.env);

// WHY the extra line: the server logs every error as its class name only
// (lib/safe-error-logging.ts hides messages), so a wrong setting met when the
// server starts would otherwise show up as nothing but "ZodError".
function parseEnvAtStartup(source: Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    console.error(`Invalid settings: ${describeInvalidSettings(parsed.error)}`);
    throw parsed.error;
  }
  return parsed.data;
}
