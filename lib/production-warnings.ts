import { readdirSync } from "node:fs";
import path from "node:path";
import { env, type Env } from "./env";
import { SOCIAL_CREDENTIAL_SETTINGS, SOCIAL_PLATFORM_LABELS, socialPlatforms } from "./social-platforms";

// In production every outside service must be real. Each stand-in left on, and
// each risky setting, is printed once at startup (fixed strings only), so a
// missed setting is noticed in the logs on the first deploy instead of by a
// customer.
export function warnAboutDevStandIns(): void {
  if (process.env.NODE_ENV !== "production") {
    return;
  }
  for (const problem of [...findProductionSettingProblems(env), ...findStandInLeftovers(env)]) {
    console.warn(`Production setting: ${problem}`);
  }
}

// Every setting that is wrong for production, as fixed sentences that never
// contain a value. Takes the settings as an argument so the checks can try
// made-up ones.
export function findProductionSettingProblems(settings: Env): string[] {
  const problems = [
    settings.SEND_REAL_EMAIL !== "true" &&
      "SEND_REAL_EMAIL is not true: emails are written to .dev-emails/ instead of sent, and received emails are read from .dev-inbound/ instead of Resend",
    settings.USE_R2_STORAGE !== "true" && "USE_R2_STORAGE is not true: files are written to .dev-files/ instead of R2",
    !settings.RESEND_API_KEY && "RESEND_API_KEY is missing: inbound email content can't be fetched",
    !settings.RESEND_WEBHOOK_SECRET && "RESEND_WEBHOOK_SECRET is missing: every Resend webhook is refused",
    !settings.INBOUND_EMAIL_DOMAIN &&
      "INBOUND_EMAIL_DOMAIN is missing: forwarding addresses use a test domain, so no customer email reaches ansa",
    isReceivingOnSendingDomain(settings) &&
      "INBOUND_EMAIL_DOMAIN is EMAIL_FROM's domain: receive on a subdomain of its own (docs/going-live.md, section 3)",
    !settings.ANTHROPIC_API_KEY &&
      "ANTHROPIC_API_KEY is missing: calls and emails can't be analysed, and the Co-Founder can't read interview answers, make marketing plans or write content drafts",
    !settings.CRON_SECRET &&
      "CRON_SECRET is missing: the scheduled jobs are off (cleanup, running stuck emails and calls again, and sending scheduled posts)",
    settings.USE_STRIPE !== "true" && "USE_STRIPE is not true: nobody can pay",
    !settings.MEDIA_PROVIDER &&
      "MEDIA_PROVIDER is not set: image generation is off, and the media page says it isn't set up (no image service is chosen yet; uploads still work)",
    settings.MEDIA_PROVIDER === "dev-stand-in" &&
      "MEDIA_PROVIDER is the development stand-in, which production refuses: image generation is off",
    isStripeTestKeyInUse(settings) &&
      "STRIPE_SECRET_KEY is a test key: Stripe charges nobody, whatever the Billing page says (docs/going-live.md, section 6)",
    settings.VAPI_SIGNATURE_PAYLOAD === "{body}" &&
      "VAPI_SIGNATURE_PAYLOAD is {body}: the timestamp isn't signed, so a copied Vapi request is accepted again at any time",
    !isNeonPooledAddress(settings.DATABASE_URL) &&
      "DATABASE_URL's host has no -pooler: with Neon, use the pooled connection string, or every server instance opens up to 10 connections of its own (docs/going-live.md, section 1)",
    sslModeOf(settings.DATABASE_URL) !== "verify-full" &&
      "DATABASE_URL doesn't say sslmode=verify-full: say it, so the database's certificate stays checked when pg changes what other modes mean (docs/going-live.md, section 1)",
    !settings.BETTER_AUTH_URL.startsWith("https://") && "BETTER_AUTH_URL is not https: links in emails will not work for customers",
    ...socialPlatformsNotSetUp(settings),
  ];
  return problems.filter((problem): problem is string => typeof problem === "string");
}

// One sentence per social platform without ansa's developer app: owners
// can't connect it, and the Accounts page says it isn't set up yet.
function socialPlatformsNotSetUp(settings: Env): string[] {
  return socialPlatforms
    .filter((platform) => !settings[SOCIAL_CREDENTIAL_SETTINGS[platform].id])
    .map((platform) => {
      const { id, secret } = SOCIAL_CREDENTIAL_SETTINGS[platform];
      const label = SOCIAL_PLATFORM_LABELS[platform];
      return `${id} and ${secret} are not set: ${label} accounts can't be connected, and the Accounts page says ${label} isn't set up yet (docs/going-live.md, section 10)`;
    });
}

// Stand-in folders that still hold files although the real service is on
// now: files and emails saved there while it was off, which the app never
// moves (docs/going-live.md, sections 2 and 3). Fixed sentences only.
// folderHoldsFiles is only replaced by the checks.
export function findStandInLeftovers(settings: Env, folderHoldsFiles: (folder: string) => boolean = holdsFiles): string[] {
  const leftovers = [
    settings.USE_R2_STORAGE === "true" &&
      folderHoldsFiles(".dev-files") &&
      "USE_R2_STORAGE is true, but .dev-files/ holds files saved while it was off: R2 doesn't have them, so those recordings and documents can't be opened",
    settings.SEND_REAL_EMAIL === "true" &&
      folderHoldsFiles(".dev-emails") &&
      "SEND_REAL_EMAIL is true, but .dev-emails/ holds emails written while it was off: they count as sent, and none of them was sent",
    // Production refuses the social stand-in whatever the settings say, so
    // anything in its folder was written by a development server.
    folderHoldsFiles(".dev-social") &&
      ".dev-social/ holds posts the development stand-in wrote: none of them reached a real platform, and production never publishes through the stand-in",
  ];
  return leftovers.filter((leftover): leftover is string => typeof leftover === "string");
}

// WHY it matters: receiving on the sending domain replaces that domain's MX
// records, and mail to EMAIL_FROM belongs to no company anyway.
function isReceivingOnSendingDomain(settings: Env): boolean {
  const sendingDomain = settings.EMAIL_FROM?.split("@").pop()?.toLowerCase();
  return settings.INBOUND_EMAIL_DOMAIN !== undefined && settings.INBOUND_EMAIL_DOMAIN === sendingDomain;
}

// lib/env.ts accepts test keys on purpose: going live starts with them.
function isStripeTestKeyInUse(settings: Env): boolean {
  return settings.USE_STRIPE === "true" && /^(sk|rk)_test_/.test(settings.STRIPE_SECRET_KEY ?? "");
}

// Neon's pooled connection strings have "-pooler" in the host name.
function isNeonPooledAddress(databaseUrl: string): boolean {
  return new URL(databaseUrl).hostname.includes("-pooler");
}

// The sslmode the address asks for, or null when it names none.
function sslModeOf(databaseUrl: string): string | null {
  return new URL(databaseUrl).searchParams.get("sslmode");
}

// Whether a folder next to the app holds a file, at any depth (empty
// recordings/ or documents/ folders strand nothing). A missing or unreadable
// folder holds nothing that could be stranded.
function holdsFiles(folder: string): boolean {
  try {
    return readdirSync(path.join(process.cwd(), folder), { recursive: true, withFileTypes: true }).some((entry) => entry.isFile());
  } catch {
    return false;
  }
}
