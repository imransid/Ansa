import "server-only";
import { publishToStandIn } from "@/adapters/dev-social";
import { facebookAdapter } from "@/adapters/facebook";
import { linkedInAdapter } from "@/adapters/linkedin";
import { xAdapter } from "@/adapters/x";
import { youTubeAdapter } from "@/adapters/youtube";
import { VIDEO_UPLOAD_TIMEOUT_MS } from "@/adapters/youtube-videos";
import { API_TIMEOUT_MS } from "@/lib/social-http";
import type { ConnectionErrorCode } from "@/lib/social-errors";
import { socialCallbackUrl, standInsAllowed, type PlatformCredentials, type PlatformMode } from "@/lib/social-mode";
import type { SocialPlatform } from "@/lib/social-platforms";
import type {
  AuthorizationResult,
  MetricsRequest,
  MetricsResult,
  PublishResult,
  PublishTarget,
  RevokeResult,
  SocialFetch,
  SocialPlatformAdapter,
  SocialPost,
} from "@/lib/social-types";

// The generic social calls core code makes (step 40): the consent screen's
// address, a code turned into connected accounts, a token renewed before it
// runs out, a post published, its numbers (step 42), and access given back.
// Each goes to the platform's adapter in /adapters, or to the development
// stand-in (adapters/dev-social.ts) for a stand-in account. No database
// here: services/social-*.ts save what comes back.

const ADAPTERS: Record<SocialPlatform, SocialPlatformAdapter> = {
  linkedin: linkedInAdapter,
  facebook: facebookAdapter,
  x: xAdapter,
  youtube: youTubeAdapter,
};

// A token is renewed when it runs out within this time, so it never runs
// out halfway through a publish (X's last two hours, Google's one).
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

// The longest one publishPost can take, every request of it running out of
// time: a YouTube video (starting its upload session, then sending the
// bytes). LinkedIn's post with an image is three requests (90 s), X's two
// (75 s), Facebook's one (60 s). The publishing queue starts a post only
// while this still fits in its time (services/publish-runs.ts).
export const LONGEST_PUBLISH_MS = API_TIMEOUT_MS + VIDEO_UPLOAD_TIMEOUT_MS;

// The longest fetchPostMetrics can take: every platform asks once (step 42).
export const LONGEST_METRICS_FETCH_MS = API_TIMEOUT_MS;

export type RequestOptions = { fetchFn: SocialFetch; now: Date };

// claimRenewal: asked right before the platform is, so only one run at a
// time renews a connection (services/social-tokens.ts claims it in /db).
export type RefreshOptions = RequestOptions & { claimRenewal: () => Promise<boolean> };

export function adapterFor(platform: SocialPlatform): SocialPlatformAdapter {
  return ADAPTERS[platform];
}

// The platform's consent screen for one connection attempt.
export function buildAuthorizeUrl(platform: SocialPlatform, credentials: PlatformCredentials, attempt: { state: string; codeChallenge: string | null }): string {
  return ADAPTERS[platform].buildAuthorizeUrl({ clientId: credentials.clientId, redirectUri: socialCallbackUrl(platform), ...attempt });
}

// The code the platform sent back -> tokens -> who the account is -> the
// accounts to connect (Facebook: one per Page the person may post to).
export async function completeAuthorization(
  platform: SocialPlatform,
  credentials: PlatformCredentials,
  input: { code: string; codeVerifier: string | null },
  options: RequestOptions,
): Promise<AuthorizationResult> {
  const request = { code: input.code, codeVerifier: input.codeVerifier, redirectUri: socialCallbackUrl(platform) };
  return ADAPTERS[platform].completeAuthorization(request, { credentials, ...options });
}

// A connection's tokens as decrypted (services/social-tokens.ts).
export type ConnectionTokens = {
  platform: SocialPlatform;
  isStandIn: boolean;
  accessToken: string;
  refreshToken: string | null;
  accessExpiresAt: Date | null;
  refreshExpiresAt: Date | null;
};

// fresh: use the token as it is. refreshed: save these, then use them.
// needs_reauth: only an owner connecting again helps. unavailable: no new
// token now (the platform didn't answer, or isn't set up): try later.
// renewing_elsewhere: another run is renewing it right now: wait for its
// new tokens (X may refuse a refresh token that was just used).
export type RefreshDecision =
  | { kind: "fresh" }
  | { kind: "refreshed"; accessToken: string; refreshToken: string | null; accessExpiresAt: Date | null; refreshExpiresAt: Date | null }
  | { kind: "needs_reauth"; code: Extract<ConnectionErrorCode, "token_expired" | "refresh_expired" | "refresh_refused"> }
  | { kind: "unavailable"; code: "refresh_unavailable" | "not_set_up" }
  | { kind: "renewing_elsewhere" };

// Renews a token about to run out, where the platform allows it: X (two
// hours) and Google (one hour) with their refresh tokens. LinkedIn renews
// only for its partners, so a member token past its 60 days needs a
// reconnect; Facebook Page tokens and the stand-in's never run out. The
// platform is asked only once options.claimRenewal() says this run may.
export async function refreshIfNeeded(connection: ConnectionTokens, mode: PlatformMode, options: RefreshOptions): Promise<RefreshDecision> {
  const { accessExpiresAt, refreshToken, refreshExpiresAt } = connection;
  const now = options.now.getTime();
  if (connection.isStandIn || accessExpiresAt === null || accessExpiresAt.getTime() - now > REFRESH_MARGIN_MS) {
    return { kind: "fresh" };
  }
  if (!refreshToken) {
    // Without a way to renew it, it works until the moment it runs out.
    return accessExpiresAt.getTime() > now ? { kind: "fresh" } : { kind: "needs_reauth", code: "token_expired" };
  }
  if (refreshExpiresAt !== null && refreshExpiresAt.getTime() <= now) {
    return { kind: "needs_reauth", code: "refresh_expired" };
  }
  if (mode.kind !== "real") {
    return { kind: "unavailable", code: "not_set_up" };
  }
  if (!(await options.claimRenewal())) {
    return { kind: "renewing_elsewhere" };
  }
  const context = { credentials: mode.credentials, fetchFn: options.fetchFn, now: options.now };
  const refreshed = await ADAPTERS[connection.platform].refreshTokens(refreshToken, context);
  if (refreshed.kind === "refused") {
    return { kind: "needs_reauth", code: "refresh_refused" };
  }
  return refreshed.kind === "unavailable" ? { kind: "unavailable", code: "refresh_unavailable" } : refreshed;
}

// Publishes one post as the account. A stand-in account writes a file, and
// never in production (IMPLEMENTATION_PLAN decision 6); a real one needs
// its platform set up on this server.
export async function publishPost(
  connection: { platform: SocialPlatform; isStandIn: boolean },
  target: PublishTarget,
  post: SocialPost,
  mode: PlatformMode,
  options: RequestOptions & { nodeEnv?: string },
): Promise<PublishResult> {
  if (connection.isStandIn) {
    const allowed = standInsAllowed(options.nodeEnv ?? process.env.NODE_ENV);
    return allowed ? publishToStandIn(connection.platform, post) : { kind: "not_created", code: "stand_in_in_production" };
  }
  if (mode.kind !== "real") {
    return { kind: "not_created", code: "not_set_up" };
  }
  return ADAPTERS[connection.platform].publish(target, post, { credentials: mode.credentials, fetchFn: options.fetchFn, now: options.now });
}

// A published post's numbers from its platform (step 42), in one request
// at most (LONGEST_METRICS_FETCH_MS). The stand-in never makes numbers up:
// its posts get theirs from pnpm simulate:post-metrics only. A real account
// needs its platform set up on this server.
export async function fetchPostMetrics(
  connection: { platform: SocialPlatform; isStandIn: boolean },
  target: PublishTarget,
  request: MetricsRequest,
  mode: PlatformMode,
  options: RequestOptions,
): Promise<MetricsResult> {
  if (connection.isStandIn) {
    return { kind: "unavailable", code: "stand_in" };
  }
  if (mode.kind !== "real") {
    return { kind: "unavailable", code: "not_set_up" };
  }
  return ADAPTERS[connection.platform].fetchPostMetrics(target, request, { credentials: mode.credentials, fetchFn: options.fetchFn, now: options.now });
}

// Asks the platform to take ansa's access back, where it offers that
// (X and Google). Best effort: the tokens are already deleted on our side.
export async function revokeAccess(
  connection: { platform: SocialPlatform; isStandIn: boolean },
  tokens: { accessToken: string | null; refreshToken: string | null },
  mode: PlatformMode,
  options: RequestOptions,
): Promise<RevokeResult> {
  if (connection.isStandIn || mode.kind !== "real") {
    return { kind: "not_offered" };
  }
  return ADAPTERS[connection.platform].revoke(tokens, { credentials: mode.credentials, ...options });
}
