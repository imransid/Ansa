import "server-only";
import { z } from "zod";
import { accountName, API_TIMEOUT_MS, discardAnswer, expiryFrom, formRequest, grantedScopes, readJsonAnswer, readJsonIfOk, sendToPlatform, toQueryString } from "@/lib/social-http";
import type { AdapterContext, SocialPlatformAdapter } from "@/lib/social-types";
import { fetchYouTubeVideoMetrics } from "./youtube-metrics";
import { publishYouTubeVideo } from "./youtube-videos";

// Translates our social calls into Google's OAuth and the YouTube Data API
// v3 (docs/research/social-publishing-apis.md, section 3; the requests as
// developers.google.com's "Using OAuth 2.0 for Web Server Applications" and
// channels.list pages write them, read 2026-10-28): access_type=offline
// for a refresh token (prompt=consent, so a reconnect gets a new one too:
// Google gives one on the first consent only), PKCE (S256), tokens of about
// an hour. Videos only: the API has no text posts. Uploading is in
// youtube-videos.ts, a video's numbers (step 42) in youtube-metrics.ts.
// NOT TESTED against Google: ansa has no verified Google Cloud project yet
// (IMPLEMENTATION_PLAN decision 7).

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true";
// youtube.upload: videos.insert. youtube.readonly: channels.list, to know
// which channel was connected (youtube.upload can't read it).
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];

const tokenAnswerSchema = z.object({
  access_token: z.string().min(1).max(8000),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().min(1).max(8000).optional(),
  refresh_token_expires_in: z.number().int().positive().optional(),
  scope: z.string().max(4000).optional(),
});

const channelsSchema = z.object({
  items: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), snippet: z.object({ title: z.string().optional() }).optional() })).optional(),
});

export const youTubeAdapter: SocialPlatformAdapter = {
  platform: "youtube",
  usesPkce: true,
  scopes: SCOPES,
  buildAuthorizeUrl(request) {
    const query = {
      client_id: request.clientId,
      redirect_uri: request.redirectUri,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      state: request.state,
      code_challenge: request.codeChallenge ?? "",
      code_challenge_method: "S256",
    };
    return `${AUTHORIZE_URL}?${toQueryString(query)}`;
  },
  async completeAuthorization(request, context) {
    const exchange = formRequest({
      code: request.code,
      client_id: context.credentials.clientId,
      client_secret: context.credentials.clientSecret,
      redirect_uri: request.redirectUri,
      grant_type: "authorization_code",
      code_verifier: request.codeVerifier ?? "",
    });
    const tokens = await readJsonIfOk(await sendToPlatform(context.fetchFn, TOKEN_URL, exchange, API_TIMEOUT_MS), tokenAnswerSchema);
    if (!tokens) {
      return { kind: "failed", code: "exchange_failed" };
    }
    // Google's consent screen can let the person untick a permission.
    const scopes = grantedScopes(tokens.scope, SCOPES);
    if (!SCOPES.every((scope) => scopes.includes(scope))) {
      return { kind: "failed", code: "missing_permission" };
    }
    const channels = await readChannels(tokens.access_token, context);
    if (!channels) {
      return { kind: "failed", code: "exchange_failed" };
    }
    const [channel] = channels.items ?? [];
    if (!channel) {
      return { kind: "failed", code: "no_channel" };
    }
    const account = {
      externalAccountId: channel.id,
      displayName: accountName(channel.snippet?.title, "YouTube channel"),
      accountKind: "channel" as const,
      scopes,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      accessExpiresAt: expiryFrom(tokens.expires_in, context.now),
      refreshExpiresAt: tokens.refresh_token ? expiryFrom(tokens.refresh_token_expires_in, context.now) : null,
    };
    return { kind: "authorized", accounts: [account] };
  },
  async refreshTokens(refreshToken, context) {
    const refresh = formRequest({
      client_id: context.credentials.clientId,
      client_secret: context.credentials.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    const answer = await sendToPlatform(context.fetchFn, TOKEN_URL, refresh, API_TIMEOUT_MS);
    if (answer.kind === "no_answer" || answer.response.status >= 500 || answer.response.status === 429) {
      return { kind: "unavailable" };
    }
    if (!answer.response.ok) {
      // invalid_grant: revoked, unused for six months, or a Testing app's 7 days.
      await discardAnswer(answer.response);
      return { kind: "refused" };
    }
    const tokens = await readJsonAnswer(answer.response, tokenAnswerSchema);
    if (!tokens) {
      return { kind: "unavailable" };
    }
    const accessExpiresAt = expiryFrom(tokens.expires_in, context.now);
    return { kind: "refreshed", accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? refreshToken, accessExpiresAt, refreshExpiresAt: null };
  },
  publish: publishYouTubeVideo,
  fetchPostMetrics: fetchYouTubeVideoMetrics,
  // Revoking the refresh token ends the whole grant, its access tokens too.
  async revoke(tokens, context) {
    const token = tokens.refreshToken ?? tokens.accessToken;
    if (!token) {
      return { kind: "not_offered" };
    }
    const answer = await sendToPlatform(context.fetchFn, REVOKE_URL, formRequest({ token }), API_TIMEOUT_MS);
    if (answer.kind === "no_answer") {
      return { kind: "failed", code: answer.code };
    }
    await discardAnswer(answer.response);
    return answer.response.ok ? { kind: "revoked" } : { kind: "failed", code: `status_${answer.response.status}` };
  },
};

// The channels of the account that just agreed (one, normally).
async function readChannels(accessToken: string, context: AdapterContext) {
  const request = { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } };
  return readJsonIfOk(await sendToPlatform(context.fetchFn, CHANNELS_URL, request, API_TIMEOUT_MS), channelsSchema);
}
