import { env } from "./env";

// In production every outside service must be real. Each stand-in left on is
// printed once at startup (fixed strings only), so a missed setting is
// noticed in the logs on the first deploy instead of by a customer.
export function warnAboutDevStandIns(): void {
  if (process.env.NODE_ENV !== "production") {
    return;
  }
  const problems = [
    env.SEND_REAL_EMAIL !== "true" && "SEND_REAL_EMAIL is not true: emails are written to .dev-emails/ instead of sent",
    env.USE_R2_STORAGE !== "true" && "USE_R2_STORAGE is not true: files are written to .dev-files/ instead of R2",
    !env.RESEND_API_KEY && "RESEND_API_KEY is missing: inbound email content can't be fetched",
    !env.RESEND_WEBHOOK_SECRET && "RESEND_WEBHOOK_SECRET is missing: every Resend webhook is refused",
    !env.ANTHROPIC_API_KEY && "ANTHROPIC_API_KEY is missing: calls and emails can't be analysed",
    !env.CRON_SECRET && "CRON_SECRET is missing: the daily cleanup is off",
    !env.BETTER_AUTH_URL.startsWith("https://") && "BETTER_AUTH_URL is not https: links in emails will not work for customers",
  ].filter(Boolean);
  for (const problem of problems) {
    console.warn(`Production setting: ${problem}`);
  }
}
