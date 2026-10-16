import "server-only";
import { z } from "zod";

const base64Key32Bytes = z
  .string()
  .refine(
    (value) => Buffer.from(value, "base64").length === 32,
    "must be 32 bytes, base64-encoded (generate with: openssl rand -base64 32)",
  );

// Fail fast at startup with a clear message instead of failing later
// with a confusing database, auth, email or webhook error.
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

    // Signing secret Resend shows for our webhook (inbound email, bounces).
    // Without it every Resend webhook is refused.
    RESEND_WEBHOOK_SECRET: z.string().startsWith("whsec_", "RESEND_WEBHOOK_SECRET must start with whsec_").optional(),

    // Encrypts call transcripts at rest (lib/encryption.ts). Losing this key
    // means losing every stored transcript, so back it up.
    DATA_ENCRYPTION_KEY: base64Key32Bytes,

    // The HMAC secret set on the Vapi credential.
    VAPI_WEBHOOK_SECRET: z.string().min(32, "VAPI_WEBHOOK_SECRET must be at least 32 characters"),
    // How Vapi signs webhooks. The defaults are our recommended Vapi HMAC
    // settings. Vapi's docs do not pin these down, so they are configurable:
    // after the first real call, match them to the Vapi dashboard.
    VAPI_SIGNATURE_HEADER: z.string().min(1).default("x-vapi-signature"),
    VAPI_TIMESTAMP_HEADER: z.string().min(1).default("x-vapi-timestamp"),
    VAPI_SIGNATURE_ALGORITHM: z.enum(["sha256", "sha512", "sha1"]).default("sha256"),
    // "{timestamp}.{body}" also signs the timestamp, which is what stops replays.
    // "{body}" signs only the body: no replay protection.
    VAPI_SIGNATURE_PAYLOAD: z.enum(["{timestamp}.{body}", "{body}"]).default("{timestamp}.{body}"),
    VAPI_SIGNATURE_ENCODING: z.enum(["hex", "base64"]).default("hex"),
    // Text in front of the signature, e.g. "sha256=". Empty = none.
    VAPI_SIGNATURE_PREFIX: z.string().default(""),
    VAPI_TIMESTAMP_UNIT: z.enum(["seconds", "milliseconds"]).default("seconds"),
    // How old (or how far in the future) a signed request may be.
    VAPI_TIMESTAMP_TOLERANCE_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),

    // Private file storage (step 14). OFF unless exactly "true": files then go to
    // .dev-files/ instead of the R2 bucket. When "true", all four R2_ values are required.
    USE_R2_STORAGE: z.enum(["true", "false"]).optional(),
    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_BUCKET: z.string().min(1).optional(),
    // Hosts we will download call recordings from, comma separated. Anything
    // else in a webhook is ignored, so a webhook can't make the server fetch
    // internal addresses.
    VAPI_RECORDING_HOSTS: z.string().min(1).default("storage.vapi.ai"),

    // The call brain (adapters/claude.ts). Without a key every call is
    // escalated to a human with reason "model unavailable".
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    // Switching models is this one line in .env.local.
    ANTHROPIC_MODEL: z
      .string()
      .regex(/^claude-[a-z0-9.-]+$/, "ANTHROPIC_MODEL must look like claude-sonnet-5-5")
      .default("claude-sonnet-5-5"),
  })
  .superRefine((values, context) => {
    if (values.USE_R2_STORAGE === "true") {
      for (const key of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] as const) {
        if (!values[key]) {
          context.addIssue({ code: "custom", path: [key], message: `${key} is required when USE_R2_STORAGE=true` });
        }
      }
    }
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
