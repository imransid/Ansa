import "server-only";
import { z } from "zod";
import { accountName, API_TIMEOUT_MS, basicAuthorization, discardAnswer, expiryFrom, formRequest, grantedScopes, readJsonAnswer, readJsonIfOk, sendToPlatform, toQueryString } from "@/lib/social-http";
import type { AdapterContext, SocialPlatformAdapter } from "@/lib/social-types";
import { fetchXPostMetrics } from "./x-metrics";
import { publishXPost } from "./x-posts";

// Translates our social calls into X's API v2 (docs/research/
// social-publishing-apis.md, section 4; the requests as docs.x.com's
// "OAuth 2.0 user access token" page writes them, read 2026-10-28):
// authorization code with PKCE (S256), ansa's app as a confidential client
// (HTTP Basic with its id and secret), tokens of two hours renewed with the
// refresh token offline.access gives. Publishing is in x-posts.ts, a
// post's numbers (step 42) in x-metrics.ts. NOT TESTED against X: ansa has
// no developer app or credits yet (IMPLEMENTATION_PLAN decision 7). Every
// post and every read is paid (section 4, pricing).

const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const REVOKE_URL = "https://api.x.com/2/oauth2/revoke";
const ME_URL = "https://api.x.com/2/users/me";
// POST /2/tweets needs tweet.read, tweet.write and users.read; images need
// media.write; offline.access brings the refresh token.
const SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access", "media.write"];

const tokenAnswerSchema = z.object({
  access_token: z.string().min(1).max(8000),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().min(1).max(8000).optional(),
  scope: z.string().max(2000).optional(),
});

const meSchema = z.object({
  data: z.object({ id: z.string().regex(/^\d{1,30}$/), name: z.string().optional(), username: z.string().regex(/^\w{1,50}$/).optional() }),
});

export const xAdapter: SocialPlatformAdapter = {
  platform: "x",
  usesPkce: true,
  scopes: SCOPES,
  buildAuthorizeUrl(request) {
    const query = {
      response_type: "code",
      client_id: request.clientId,
      redirect_uri: request.redirectUri,
      scope: SCOPES.join(" "),
      state: request.state,
      code_challenge: request.codeChallenge ?? "",
      code_challenge_method: "S256",
    };
    return `${AUTHORIZE_URL}?${toQueryString(query)}`;
  },
  async completeAuthorization(request, context) {
    const exchange = { code: request.code, grant_type: "authorization_code", redirect_uri: request.redirectUri, code_verifier: request.codeVerifier ?? "" };
    const tokens = await readJsonIfOk(await sendToPlatform(context.fetchFn, TOKEN_URL, tokenRequest(exchange, context), API_TIMEOUT_MS), tokenAnswerSchema);
    const me = tokens ? await readMe(tokens.access_token, context) : null;
    if (!tokens || !me) {
      return { kind: "failed", code: "exchange_failed" };
    }
    const { id, name, username } = me.data;
    const account = {
      externalAccountId: id,
      displayName: accountName(username ? `${name ?? username} (@${username})` : name, "X account"),
      accountKind: "account" as const,
      scopes: grantedScopes(tokens.scope, SCOPES),
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      accessExpiresAt: expiryFrom(tokens.expires_in, context.now),
      refreshExpiresAt: null,
    };
    return { kind: "authorized", accounts: [account] };
  },
  // Whether X hands out a new refresh token each time is not confirmed:
  // the new one is kept when it comes, else the old one.
  async refreshTokens(refreshToken, context) {
    const answer = await sendToPlatform(context.fetchFn, TOKEN_URL, tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" }, context), API_TIMEOUT_MS);
    if (answer.kind === "no_answer" || answer.response.status >= 500 || answer.response.status === 429) {
      return { kind: "unavailable" };
    }
    if (!answer.response.ok) {
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
  publish: publishXPost,
  fetchPostMetrics: fetchXPostMetrics,
  // The refresh token first (it would mint new access tokens), then the access token.
  async revoke(tokens, context) {
    for (const token of [tokens.refreshToken, tokens.accessToken]) {
      if (!token) {
        continue;
      }
      const answer = await sendToPlatform(context.fetchFn, REVOKE_URL, tokenRequest({ token }, context), API_TIMEOUT_MS);
      if (answer.kind === "no_answer") {
        return { kind: "failed", code: answer.code };
      }
      await discardAnswer(answer.response);
      if (!answer.response.ok) {
        return { kind: "failed", code: `status_${answer.response.status}` };
      }
    }
    return { kind: "revoked" };
  },
};

// A form POST to X's token or revoke endpoint as a confidential client:
// HTTP Basic with ansa's id and secret, no client_id in the body.
function tokenRequest(params: Record<string, string>, context: AdapterContext): RequestInit {
  return formRequest(params, { Authorization: basicAuthorization(context.credentials.clientId, context.credentials.clientSecret) });
}

// Who the account is: GET /2/users/me with its new token.
async function readMe(accessToken: string, context: AdapterContext) {
  const request = { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } };
  return readJsonIfOk(await sendToPlatform(context.fetchFn, ME_URL, request, API_TIMEOUT_MS), meSchema);
}
