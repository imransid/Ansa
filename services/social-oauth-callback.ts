import "server-only";
import type { z } from "zod";
import { claimOauthState, type ClaimedOauthState } from "@/db/oauth-states";
import { canManageSocialAccounts } from "@/lib/cofounder/permissions";
import { decryptForDisplay } from "@/lib/encryption";
import { oauthPkceVerifierContext } from "@/lib/encryption-contexts";
import { buildLoginUrl } from "@/lib/login-redirect";
import { hashOauthState } from "@/lib/oauth-state";
import type { SessionContext } from "@/lib/session";
import type { ConnectResult } from "@/lib/social-errors";
import type { PlatformCredentials } from "@/lib/social-mode";
import type { SocialPlatform } from "@/lib/social-platforms";
import { completeAuthorization } from "@/lib/social-publishing";
import { oauthCodeParamSchema, oauthErrorParamSchema, oauthStateParamSchema, socialPlatformSchema } from "@/lib/validation/social";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";
import { saveAuthorizedAccounts } from "./social-account-saving";
import { resolveSocialOptions, type ResolvedSocialOptions, type SocialOptions } from "./social-options";

// Where a platform sends the owner back after its consent screen (step 40,
// GET /api/social/<platform>/callback). Every answer is a redirect to our
// Accounts page with a result code in its address (lib/social-errors.ts):
// never a token, the code, the state or anything the platform wrote.

const ACCOUNTS_PAGE = "/cofounder/accounts";

// The "error" values meaning the person said no: OAuth's own, and
// LinkedIn's and Facebook's names for it.
const DENIALS = ["access_denied", "user_cancelled_login", "user_cancelled_authorize", "user_denied"];

type Completion = { result: ConnectResult; count: number };

// Answers the platform's redirect: 404 for an unknown platform, the login
// page without a session, else the Accounts page with what became of it.
export async function handleSocialCallback(session: SessionContext | null, platformParam: string, query: URLSearchParams, options: SocialOptions = {}): Promise<Response> {
  const platform = socialPlatformSchema.safeParse(platformParam);
  if (!platform.success) {
    return new Response(null, { status: 404 });
  }
  if (!session) {
    // The attempt stays unused and expires: it can't be finished without its owner's login.
    return redirectTo(buildLoginUrl(ACCOUNTS_PAGE));
  }
  const completion = await completeConnection(session, platform.data, query, options);
  if (completion.result !== "connected") {
    // Fixed words and codes only: never the state, the code or the platform's text.
    console.warn(`Social connection not made: ${platform.data} ${completion.result}`);
  }
  const count = completion.count > 1 ? `&count=${completion.count}` : "";
  return redirectTo(`${ACCOUNTS_PAGE}?result=${completion.result}&platform=${platform.data}${count}`);
}

// The callback's checks, in order: the person's limit, the state (used up
// here, whatever comes next), the platform's answer, the code, the owner,
// the platform set up; then the exchange.
async function completeConnection(session: SessionContext, platform: SocialPlatform, query: URLSearchParams, options: SocialOptions): Promise<Completion> {
  if (await isOverRateLimit("social-accounts", session.userId, RATE_LIMITS.socialAccountChangesPerUser)) {
    return { result: "rate_limited", count: 0 };
  }
  const state = readQueryValue(query, "state", oauthStateParamSchema);
  const attempt = state ? await claimOauthState(session.companyId, session.userId, platform, hashOauthState(state)) : null;
  if (!attempt) {
    return { result: "expired_state", count: 0 };
  }
  if (query.has("error")) {
    const error = readQueryValue(query, "error", oauthErrorParamSchema);
    return { result: error && DENIALS.includes(error) ? "denied" : "provider_error", count: 0 };
  }
  const code = readQueryValue(query, "code", oauthCodeParamSchema);
  if (!code) {
    return { result: "missing_code", count: 0 };
  }
  if (!canManageSocialAccounts(session.role)) {
    return { result: "not_owner", count: 0 };
  }
  const resolved = resolveSocialOptions(options);
  const mode = resolved.modeOf(platform);
  if (mode.kind !== "real") {
    return { result: "not_set_up", count: 0 };
  }
  return exchangeAndSave(session, platform, { ...attempt, code }, mode.credentials, resolved);
}

// The code (with the attempt's PKCE verifier) turned into accounts by the
// platform, and those saved for the session's company.
async function exchangeAndSave(
  session: SessionContext,
  platform: SocialPlatform,
  attempt: ClaimedOauthState & { code: string },
  credentials: PlatformCredentials,
  options: ResolvedSocialOptions,
): Promise<Completion> {
  const verifier = decryptForDisplay(attempt.pkceVerifierEncrypted, oauthPkceVerifierContext(session.companyId, attempt.id));
  if (verifier.unreadable) {
    return { result: "exchange_failed", count: 0 };
  }
  const request = { code: attempt.code, codeVerifier: verifier.text };
  const authorization = await completeAuthorization(platform, credentials, request, { fetchFn: options.fetchFn, now: options.now });
  if (authorization.kind === "failed") {
    return { result: authorization.code, count: 0 };
  }
  const saved = await saveAuthorizedAccounts(session.companyId, session.userId, platform, authorization.accounts, false);
  if (saved !== "saved") {
    return { result: saved === "not-allowed" ? "not_owner" : "exchange_failed", count: 0 };
  }
  return { result: "connected", count: authorization.accounts.length };
}

// One value of the query (the first, when it is repeated), or null when it
// is missing or not of that shape.
function readQueryValue(query: URLSearchParams, name: string, schema: z.ZodType<string>): string | null {
  const parsed = schema.safeParse(query.get(name));
  return parsed.success ? parsed.data : null;
}

// A redirect to a page of ours, never cached: it answers one person's
// return from a platform, once.
function redirectTo(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}
