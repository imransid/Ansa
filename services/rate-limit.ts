import "server-only";
import { createHmac } from "node:crypto";
import { recordAttemptAndCount, removeOneAttempt } from "@/db/rate-limits";
import { env } from "@/lib/env";

type RateLimitRule = {
  maxAttempts: number;
  windowSeconds: number;
};

export const RATE_LIMITS = {
  // New companies from one IP.
  signupPerIp: { maxAttempts: 10, windowSeconds: 60 * 60 },
  // A whole team joining from one office IP on its first day. Each join needs
  // a single-use invite for that exact address, so this can be high.
  inviteJoinsPerIp: { maxAttempts: 60, windowSeconds: 60 * 60 },
  // Tries on one invite link, from anywhere. Joining takes one; more is only
  // someone hammering that link.
  inviteJoinsPerInvite: { maxAttempts: 10, windowSeconds: 60 * 60 },
  // Login limits (services/login-limits.ts). A login whose password is right
  // takes its attempts back, so only failures add up.
  // One office IP: a team typing passwords at shift start shares this.
  loginPerIp: { maxAttempts: 100, windowSeconds: 15 * 60 },
  // Guessing one account's password from one place. A stranger elsewhere has
  // their own counter, so they can't lock the real user out.
  loginPerEmailAndIp: { maxAttempts: 10, windowSeconds: 15 * 60 },
  // Guessing one account's password from many places at once. Anyone with
  // enough IPs can fill it, so it only applies to browsers that never logged
  // in to that account.
  loginPerEmail: { maxAttempts: 100, windowSeconds: 60 * 60 },
  // A browser that logged in to the account before (lib/known-device.ts) uses
  // this instead of the cap above. Low: a stolen cookie must not buy a thief
  // many guesses from many IPs.
  loginPerKnownDevice: { maxAttempts: 10, windowSeconds: 15 * 60 },
  verifyEmailPerIp: { maxAttempts: 20, windowSeconds: 15 * 60 },
  // Anyone can sign up any address, and every login of an unconfirmed account
  // mails a new link. These caps stop that from flooding someone's inbox.
  verificationEmailsPerAddress: { maxAttempts: 3, windowSeconds: 60 * 60 },
  existingAccountEmailsPerAddress: { maxAttempts: 3, windowSeconds: 60 * 60 },
  // Anyone can ask for a reset link for any address: per IP against one
  // machine asking for many addresses, per address against inbox floods.
  passwordResetRequestsPerIp: { maxAttempts: 20, windowSeconds: 60 * 60 },
  passwordResetEmailsPerAddress: { maxAttempts: 3, windowSeconds: 60 * 60 },
  // Submitting reset links. They can't be guessed; this only stops hammering.
  passwordResetsPerIp: { maxAttempts: 20, windowSeconds: 15 * 60 },
  // Current-password guesses by someone holding a logged-in browser.
  passwordChangesPerUser: { maxAttempts: 10, windowSeconds: 15 * 60 },
  // Name changes and "sign out on all other devices" (Account page).
  accountChangesPerUser: { maxAttempts: 30, windowSeconds: 10 * 60 },
  // Creating and revoking invite links count separately, so onboarding a big
  // team isn't stopped by cleaning up old links (or the other way round).
  inviteCreationsPerCompany: { maxAttempts: 200, windowSeconds: 60 * 60 },
  inviteRevocationsPerCompany: { maxAttempts: 200, windowSeconds: 60 * 60 },
  invitePreviewPerIp: { maxAttempts: 30, windowSeconds: 15 * 60 },
  ticketChangesPerUser: { maxAttempts: 120, windowSeconds: 10 * 60 },
  // Tickets one person types in, or escalates from calls the AI marked solved
  // (step 31). Each can email the teammate routing picks, so it stays well
  // below what anyone types by hand.
  ticketCreationsPerUser: { maxAttempts: 30, windowSeconds: 10 * 60 },
  // Customer emails ("solved") one company can send in a day, counting every
  // delivery attempt (solve and Retry). Every company sends from our one
  // address, so one company mailing strangers (set an address, solve, reopen,
  // repeat) would hurt delivery for all of them.
  customerEmailsPerCompany: { maxAttempts: 300, windowSeconds: 24 * 60 * 60 },
  // Signed requests only, and every company's calls arrive from Vapi's own few
  // addresses, so this is one bucket for the whole platform. Far above any
  // real peak (step 27): a 429 here loses that call's report for good (Vapi
  // doesn't retry). It only matters if the secret ever leaks. Vapi should send
  // end-of-call-report only (docs/going-live.md, serverMessages). The live
  // calls' knowledge searches (step 35) arrive here too, and a 429 leaves
  // that search unanswered.
  vapiWebhookPerIp: { maxAttempts: 10_000, windowSeconds: 60 },
  // Categories and who handles them, removing teammates and changing roles
  // (Team page), company setup, and the Co-Founder's support-trends setting.
  settingsChangesPerUser: { maxAttempts: 60, windowSeconds: 10 * 60 },
  recordingViewsPerUser: { maxAttempts: 200, windowSeconds: 10 * 60 },
  documentUploadsPerUser: { maxAttempts: 20, windowSeconds: 10 * 60 },
  documentDownloadsPerUser: { maxAttempts: 200, windowSeconds: 10 * 60 },
  resendWebhookPerIp: { maxAttempts: 600, windowSeconds: 60 },
  // One sender can open at most this many tickets an hour (stops mail floods).
  // The sender is the Reply-To when there is one (contact forms, step 27).
  inboundEmailsPerSender: { maxAttempts: 10, windowSeconds: 60 * 60 },
  // Claude triages at most this many emails an hour per company. From can be
  // anything, so the per-sender limit doesn't stop one sender using many
  // addresses. Above it, emails still become tickets, only without the AI.
  emailTriagesPerCompany: { maxAttempts: 100, windowSeconds: 60 * 60 },
  // "Process again" / "Make a ticket anyway" on the Emails page (each can be
  // a paid Claude call).
  emailRetriesPerUser: { maxAttempts: 20, windowSeconds: 10 * 60 },
  // The daily job's calls with the secret from one address (a call without
  // it is refused first and never counted: services/maintenance.ts).
  cronPerIp: { maxAttempts: 30, windowSeconds: 60 * 60 },
  // GET /api/health (services/health.ts). An uptime monitor asks every minute
  // or so; each answer costs two small database round trips.
  healthChecksPerIp: { maxAttempts: 60, windowSeconds: 60 },
  billingActionsPerUser: { maxAttempts: 20, windowSeconds: 10 * 60 },
  stripeWebhookPerIp: { maxAttempts: 600, windowSeconds: 60 },
  // Each analysis is a paid Claude call.
  callAnalysisPerUser: { maxAttempts: 20, windowSeconds: 10 * 60 },
  // Knowledge (step 34). Writes: new articles, edits, approving, archiving,
  // restoring and deleting, by one person.
  knowledgeWritesPerUser: { maxAttempts: 60, windowSeconds: 10 * 60 },
  // "Add to knowledge" and "Import a web page" for one company: each reads a
  // file or fetches a page and can make up to 10 drafts.
  knowledgeImportsPerCompany: { maxAttempts: 20, windowSeconds: 60 * 60 },
  // "Test what the AI finds": each is one search.
  knowledgeTestSearchesPerUser: { maxAttempts: 30, windowSeconds: 60 },
  // Searches the voice assistant makes during live calls (step 35), all of a
  // company's calls together: about 40 calls at once each asking every 20
  // seconds. On top of vapiWebhookPerIp; it only matters if Vapi's secret
  // leaks, or an assistant loops on the tool.
  knowledgeLookupsPerCompany: { maxAttempts: 120, windowSeconds: 60 },
  // The Co-Founder (step 36). Interview answers of one company, every owner
  // together: each is a paid Claude call. A whole interview is about 30.
  onboardingTurnsPerCompany: { maxAttempts: 60, windowSeconds: 60 * 60 },
  // "Suggest facts from knowledge" for one company: each reads an article
  // with Claude.
  factSuggestionsPerCompany: { maxAttempts: 20, windowSeconds: 60 * 60 },
  // Confirming, editing and dismissing facts, and "Start over", by one person.
  businessProfileChangesPerUser: { maxAttempts: 120, windowSeconds: 10 * 60 },
  // Marketing plans of one company (step 37), every owner together: each is
  // a long, paid Claude call, and an owner makes a few at a time at most.
  marketingPlansPerCompany: { maxAttempts: 10, windowSeconds: 60 * 60 },
  // The content studio (step 38). Texts the AI writes for one company (new
  // drafts and Regenerate), everyone together: each is a paid Claude call,
  // and a week of posts for four platforms is about 20.
  contentGenerationsPerCompany: { maxAttempts: 30, windowSeconds: 60 * 60 },
  // Blank drafts, edits, approving, rejecting, archiving and restoring, by one person.
  contentDraftChangesPerUser: { maxAttempts: 120, windowSeconds: 10 * 60 },
  // The media library (step 39). Uploads by one person, each up to 4 MB.
  mediaUploadsPerUser: { maxAttempts: 30, windowSeconds: 10 * 60 },
  // Files /api/media serves to one person: a page of the library shows up
  // to 50 of them, each its own request, and a draft's page a few more.
  mediaViewsPerUser: { maxAttempts: 1_000, windowSeconds: 10 * 60 },
  // Alt text, deleting, attaching to or taking off a draft, canceling and
  // "Start now", by one person.
  mediaChangesPerUser: { maxAttempts: 120, windowSeconds: 10 * 60 },
  // Images and videos one company asks for in a day, everyone together:
  // each will be a paid request once a real image service is chosen.
  mediaGenerationsPerCompany: { maxAttempts: 30, windowSeconds: 24 * 60 * 60 },
  // Social accounts (step 40), by one person: each Connect, each return
  // from a platform (it calls the platform), each stand-in account and
  // each Disconnect. Connecting one account takes two.
  socialAccountChangesPerUser: { maxAttempts: 30, windowSeconds: 10 * 60 },
  // The publishing queue (step 41), by one person: scheduling, canceling,
  // "Publish now", Retry, marking a post, and the auto-publish rules.
  publishingChangesPerUser: { maxAttempts: 120, windowSeconds: 10 * 60 },
  // Posts one company tries to publish in a day, every account together,
  // counting every try (a Retry, a try after a platform asked to wait).
  // A busy day for four platforms is about ten; each X post costs ansa's
  // app money, and a stolen owner login must not flood the accounts.
  publishAttemptsPerCompany: { maxAttempts: 30, windowSeconds: 24 * 60 * 60 },
  // "Plan the next 2 weeks" for one company: each is a paid Claude call.
  calendarPlansPerCompany: { maxAttempts: 10, windowSeconds: 60 * 60 },
  // /api/cron/publish: a scheduler with the secret calling every minute, with
  // room to spare (calls without it are never counted: services/publish-cron.ts).
  publishCronPerIp: { maxAttempts: 300, windowSeconds: 60 * 60 },
  // "Review performance" on the Analytics page (step 42) for one company,
  // every owner together: each is a paid Claude call, and the numbers move
  // once a day.
  performanceReviewsPerCompany: { maxAttempts: 10, windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimitRule>;

// Returns the longest window of the rules above, in seconds. The daily cleanup
// keeps every counter longer than this (services/maintenance.ts).
export function longestRateLimitWindowSeconds(): number {
  const windows = Object.values(RATE_LIMITS).map((rule) => rule.windowSeconds);
  return Math.max(...windows);
}

// Counts one attempt and returns true when the caller has gone over the limit.
export async function isOverRateLimit(
  action: string,
  identifier: string,
  rule: RateLimitRule,
): Promise<boolean> {
  const attempts = await recordAttemptAndCount(rateLimitKey(action, identifier), rule.windowSeconds);
  return attempts > rule.maxAttempts;
}

// Takes back one attempt counted by isOverRateLimit, for attempts that should
// not count after all (a login attempt whose password was right).
export async function takeBackRateLimitAttempt(action: string, identifier: string): Promise<void> {
  await removeOneAttempt(rateLimitKey(action, identifier));
}

// A key of its own, made from BETTER_AUTH_SECRET (as lib/known-device.ts does),
// so it is never the very key Better Auth signs with.
const RATE_LIMIT_KEY_SECRET = createHmac("sha256", env.BETTER_AUTH_SECRET).update("ansa rate limit keys").digest();

// The stored key is an HMAC of the action and the IP address or email, made
// with a server secret. WHY not a plain hash: there are only 2^32 IPv4
// addresses and emails can be guessed, so anyone holding a copy of the
// database could turn plain SHA-256 keys back into them. Without the secret
// they can't. Changing BETTER_AUTH_SECRET resets every counter, which is harmless.
function rateLimitKey(action: string, identifier: string): string {
  return createHmac("sha256", RATE_LIMIT_KEY_SECRET).update(`${action}:${identifier}`).digest("hex");
}
