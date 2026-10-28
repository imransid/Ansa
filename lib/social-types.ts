import type { PostMetricValues } from "@/lib/metric-definitions";
import type { MetricsErrorCode } from "@/lib/metrics-errors";
import type { PlatformCredentials } from "@/lib/social-mode";
import type { ConnectFailureCode, PublishErrorCode } from "@/lib/social-errors";
import type { SocialAccountKind, SocialPlatform } from "@/lib/social-platforms";

// What every social platform's adapter offers (step 40): one file per
// platform in /adapters, called only through lib/social-publishing.ts.
// Core code never talks to a platform any other way. Adding a platform =
// its adapter, one line in lib/social-publishing.ts and its name in
// lib/social-platforms.ts.

// The fetch an adapter sends every request through. The real one by
// default; the checks pass a fake that answers like the platform.
export type SocialFetch = (url: string, init: RequestInit) => Promise<Response>;

export type AdapterContext = { credentials: PlatformCredentials; fetchFn: SocialFetch; now: Date };

// The authorize URL's parts that change per attempt (lib/oauth-state.ts).
export type AuthorizeRequest = { clientId: string; redirectUri: string; state: string; codeChallenge: string | null };

export type CodeExchangeRequest = { code: string; redirectUri: string; codeVerifier: string | null };

// One account the person allowed ansa to post to, with its own tokens
// (Facebook: one per Page, each with that Page's token).
export type AuthorizedAccount = {
  externalAccountId: string;
  displayName: string;
  accountKind: SocialAccountKind;
  scopes: string[];
  accessToken: string;
  refreshToken: string | null;
  // null: the platform gave no expiry.
  accessExpiresAt: Date | null;
  refreshExpiresAt: Date | null;
};

export type AuthorizationResult = { kind: "authorized"; accounts: AuthorizedAccount[] } | { kind: "failed"; code: ConnectFailureCode };

// refused: the platform said no to the refresh token (it was revoked, or
// ran out). unavailable: no clear answer; the old token may still work.
export type RefreshResult =
  | { kind: "refreshed"; accessToken: string; refreshToken: string | null; accessExpiresAt: Date | null; refreshExpiresAt: Date | null }
  | { kind: "refused" }
  | { kind: "unavailable" };

// An image or video from the media library (step 39), as its bytes.
export type SocialMedia = { kind: "image" | "video"; contentType: string; bytes: Buffer; altText: string };

// One post as the platform publishes it: the text (composePublishedText in
// lib/content-rules.ts), YouTube's title ("" elsewhere), and at most one file.
export type SocialPost = { text: string; title: string; media: SocialMedia | null };

// Who posts: the platform's id of the account, and a token that works now
// (services/social-tokens.ts renews it first).
export type PublishTarget = { externalAccountId: string; accessToken: string };

// published: the platform made it (url null: the stand-in, nothing to open).
// not_created: the platform said no, or it never got that far: nothing was
// posted, and trying again later can't post it twice. unclear: the platform
// may have made it (a 5xx, a cut-off answer): never tried again
// automatically (IMPLEMENTATION_PLAN decision 8), a person checks first.
// Which answer is which follows docs/research/social-publishing-apis.md,
// "Definitely not created" and "Unclear outcome", per platform.
export type PublishResult =
  | { kind: "published"; externalPostId: string; url: string | null }
  | { kind: "not_created"; code: PublishErrorCode; retryAfterSeconds?: number }
  | { kind: "unclear"; code: PublishErrorCode };

// Whether the platform was asked to take ansa's access back. Best effort:
// disconnecting never waits on it or fails because of it.
export type RevokeResult = { kind: "revoked" } | { kind: "not_offered" } | { kind: "failed"; code: string };

// One published post whose numbers are asked for (step 42): the platform's
// id of it, and when it went out (X keeps some numbers 30 days only).
export type MetricsRequest = { externalPostId: string; publishedAt: Date };

// collected: the numbers, each null where the platform gave none (never 0
// for unknown; lib/metric-definitions.ts says which it can give). unavailable:
// there was nothing to ask (a permission ansa doesn't have, the stand-in,
// not set up). failed: the platform refused or didn't answer; tried again
// tomorrow, never a snapshot.
export type MetricsResult =
  | { kind: "collected"; values: PostMetricValues }
  | { kind: "unavailable"; code: MetricsErrorCode }
  | { kind: "failed"; code: MetricsErrorCode };

export type SocialPlatformAdapter = {
  platform: SocialPlatform;
  usesPkce: boolean;
  // What ansa asks for on the consent screen, in the platform's own names.
  scopes: readonly string[];
  buildAuthorizeUrl(request: AuthorizeRequest): string;
  // The code -> tokens -> who the account is -> one or more accounts.
  completeAuthorization(request: CodeExchangeRequest, context: AdapterContext): Promise<AuthorizationResult>;
  refreshTokens(refreshToken: string, context: AdapterContext): Promise<RefreshResult>;
  publish(target: PublishTarget, post: SocialPost, context: AdapterContext): Promise<PublishResult>;
  // A published post's numbers (step 42), one request at most.
  fetchPostMetrics(target: PublishTarget, request: MetricsRequest, context: AdapterContext): Promise<MetricsResult>;
  revoke(tokens: { accessToken: string | null; refreshToken: string | null }, context: AdapterContext): Promise<RevokeResult>;
};
