// The checks sign up companies, send emails, store files and post payments.
// They must only ever run against a local database with every outside service
// off: real email would go to made-up @example.test addresses (hurting the
// sender's reputation), files would stay in the real bucket for good (cleanup
// only empties .dev-files/), and test companies would land in production.
// Social platform apps (step 40) and ansa's Telegram bot (step 48) are
// refused too: the checks answer for the platforms and Telegram with fake
// fetches, and a real app or bot set by mistake must never be asked anything.

// Postgres hosts the checks may use. CI and the local Docker database use
// 127.0.0.1; pnpm db:up publishes on localhost too.
const LOCAL_DATABASE_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

// Each of these means "use the real service" when exactly "true" (lib/env.ts).
const REAL_SERVICE_SWITCHES = ["SEND_REAL_EMAIL", "USE_R2_STORAGE", "USE_STRIPE"];

// Each of these, set at all, is a real social platform's app (lib/social-platforms.ts).
const SOCIAL_APP_SETTINGS = ["LINKEDIN_CLIENT_ID", "FACEBOOK_APP_ID", "X_CLIENT_ID", "GOOGLE_CLIENT_ID"];

// Set at all, this is ansa's real Telegram bot (lib/telegram-settings.ts).
const TELEGRAM_BOT_SETTING = "TELEGRAM_BOT_TOKEN";

// Why the checks must not run with these settings, or null when they may.
// Never names a value (DATABASE_URL holds a password).
export function findReasonNotToRunChecks(settings: Record<string, string | undefined>): string | null {
  for (const name of REAL_SERVICE_SWITCHES) {
    if (settings[name] === "true") {
      return `${name} is "true", so the checks would use the real service. Set it to false to run them.`;
    }
  }
  for (const name of SOCIAL_APP_SETTINGS) {
    if (settings[name]) {
      return `${name} is set, so the checks could reach that social platform. Leave it unset to run them.`;
    }
  }
  if (settings[TELEGRAM_BOT_SETTING]) {
    return `${TELEGRAM_BOT_SETTING} is set, so the checks could reach Telegram. Leave it unset (comment out the three TELEGRAM_ lines) to run them.`;
  }
  if (!isLocalDatabase(settings)) {
    return "DATABASE_URL does not point at localhost or 127.0.0.1. The checks only run against a local database.";
  }
  return null;
}

// Whether DATABASE_URL points at this machine (pnpm telegram:poll needs it
// with the real bot set, so it can't use the checks' guard above).
export function isLocalDatabase(settings: Record<string, string | undefined>): boolean {
  return LOCAL_DATABASE_HOSTS.includes(databaseHost(settings.DATABASE_URL));
}

function databaseHost(databaseUrl: string | undefined): string {
  try {
    // postgres:// is not a scheme URL lowercases on its own.
    return new URL(databaseUrl ?? "").hostname.toLowerCase();
  } catch {
    return "";
  }
}
