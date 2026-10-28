import "server-only";
import { z } from "zod";
import { mediaProviderNames } from "./media/kinds";
import { requireSocialAppPairs, socialAppSettings } from "./social-settings";

const base64Key32Bytes = z
  .string()
  .refine(
    (value) => Buffer.from(value, "base64").length === 32,
    "must be 32 bytes, base64-encoded (generate with: openssl rand -base64 32)",
  );

// A bare domain name such as "inbound.example.com": lowercase labels joined by
// dots, the last one starting with a letter. No "@", scheme, port or path.
const DOMAIN_NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

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
    // written to .dev-emails/ instead of being sent, and received emails are
    // read from the .dev-inbound/ stand-in (pnpm simulate:inbound-email)
    // instead of Resend (lib/inbound-email.ts). Values like "yes" or "TRUE"
    // are rejected so nobody turns it on (or off) by accident.
    SEND_REAL_EMAIL: z.enum(["true", "false"]).optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    // Plain address, e.g. support@yourdomain.com. Customer and assignment
    // emails show "<company name> via ansa" as the sender name.
    EMAIL_FROM: z.email().optional(),

    // Signing secret Resend shows for our webhook (inbound email, bounces).
    // Without it every Resend webhook is refused.
    RESEND_WEBHOOK_SECRET: z.string().startsWith("whsec_", "RESEND_WEBHOOK_SECRET must start with whsec_").optional(),
    // The domain Resend receives email on, e.g. inbound.yourdomain.com. Every
    // company's forwarding address is c-<token>@<this domain>
    // (lib/forwarding-address.ts). Use a subdomain of its own, never
    // EMAIL_FROM's domain. Never change it once companies forward to it: their
    // forwarding, and the Reply-To of every email already sent, use the old
    // domain, and only the current one is read. Required when
    // SEND_REAL_EMAIL=true. Unset (development): inbound.ansa.test.
    INBOUND_EMAIL_DOMAIN: z
      .string()
      .trim()
      .toLowerCase()
      .regex(DOMAIN_NAME, "INBOUND_EMAIL_DOMAIN must be a domain name like inbound.yourdomain.com")
      .optional(),

    // The scheduler sends it as "Authorization: Bearer <secret>" when calling
    // /api/cron/cleanup or /api/cron/publish (Vercel Cron does this by itself
    // when it is set). Without it both routes answer 404.
    CRON_SECRET: z.string().min(32, "CRON_SECRET must be at least 32 characters").optional(),

    // Encrypts sensitive text at rest (lib/encryption.ts): call transcripts,
    // what Claude wrote about each call (and the customer's sentence behind a
    // "solved"), received emails' subjects, bodies and attachment names, and
    // ticket notes. Losing this key means losing all of them, so back it up.
    DATA_ENCRYPTION_KEY: base64Key32Bytes,

    // The HMAC secret set on the Vapi credential.
    VAPI_WEBHOOK_SECRET: z.string().min(32, "VAPI_WEBHOOK_SECRET must be at least 32 characters"),
    // How Vapi signs webhooks. The defaults are those of a Vapi HMAC
    // credential (its signatureHeader and timestampHeader, checked
    // 2026-10-26), so a credential left at its defaults works. Not tried on a
    // real call yet, so they stay configurable: after the first real call,
    // match them to the Vapi dashboard.
    VAPI_SIGNATURE_HEADER: z.string().min(1).default("x-signature"),
    VAPI_TIMESTAMP_HEADER: z.string().min(1).default("x-timestamp"),
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

    // Payments (step 18). OFF unless exactly "true": the Billing page then only
    // offers "simulate" buttons and nothing is charged. When "true", all three
    // STRIPE_ values are required. Pricing lives in Stripe (the price id).
    USE_STRIPE: z.enum(["true", "false"]).optional(),
    STRIPE_SECRET_KEY: z.string().regex(/^(sk|rk)_(test|live)_/, "STRIPE_SECRET_KEY must start with sk_test_, sk_live_ or rk_").optional(),
    STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_", "STRIPE_WEBHOOK_SECRET must start with whsec_").optional(),
    STRIPE_PRICE_ID: z.string().startsWith("price_", "STRIPE_PRICE_ID must start with price_").optional(),

    // The call brain (adapters/claude.ts). Without a key every call is
    // escalated to a human with reason "model unavailable".
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    // Switching models is this one line in .env.local.
    ANTHROPIC_MODEL: z
      .string()
      .regex(/^claude-[a-z0-9.-]+$/, "ANTHROPIC_MODEL must look like claude-sonnet-5-5")
      .default("claude-sonnet-5-5"),

    // Image and video generation (step 39, lib/media-generation.ts): which
    // service makes them. No real one is chosen yet, so the only value is
    // the development stand-in. Unset in development = the stand-in. In
    // production the stand-in is refused: unset (or the stand-in) means
    // generation is off, and the media page says it isn't set up.
    MEDIA_PROVIDER: z.enum(mediaProviderNames).optional(),

    // Social accounts (step 40): ansa's developer app per platform, in
    // pairs (LINKEDIN_, FACEBOOK_APP_, X_ and GOOGLE_ CLIENT_ID / SECRET).
    ...socialAppSettings,
  })
  .superRefine(requireSocialAppPairs)
  .superRefine((values, context) => {
    if (values.USE_R2_STORAGE === "true") {
      for (const key of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] as const) {
        if (!values[key]) {
          context.addIssue({ code: "custom", path: [key], message: `${key} is required when USE_R2_STORAGE=true` });
        }
      }
    }
    if (values.USE_STRIPE === "true") {
      for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_ID"] as const) {
        if (!values[key]) {
          context.addIssue({ code: "custom", path: [key], message: `${key} is required when USE_STRIPE=true` });
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
    // Real emails carry the forwarding address as their Reply-To. On the
    // development domain every customer reply would bounce.
    if (!values.INBOUND_EMAIL_DOMAIN) {
      context.addIssue({
        code: "custom",
        path: ["INBOUND_EMAIL_DOMAIN"],
        message: "INBOUND_EMAIL_DOMAIN is required when SEND_REAL_EMAIL=true",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

// Exported so scripts/tenant-isolation can check the rules with fake values.
export function parseEnv(source: Record<string, string | undefined>): Env {
  return envSchema.parse(source);
}

// One line naming each wrong setting and the rule it breaks, never its value
// (Zod's messages describe the rule, not what was given). Exported for the checks.
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
