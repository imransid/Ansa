import "server-only";
import { z } from "zod";
import { accountName, API_TIMEOUT_MS, discardAnswer, expiryFrom, formRequest, grantedScopes, readJsonAnswer, readJsonIfOk, sendToPlatform, toQueryString } from "@/lib/social-http";
import type { AdapterContext, SocialPlatformAdapter } from "@/lib/social-types";
import { publishLinkedInPost } from "./linkedin-posts";

// Translates our social calls into LinkedIn's API: member posts through the
// Posts API (docs/research/social-publishing-apis.md, section 1; publishing
// is in linkedin-posts.ts), the 3-legged OAuth flow, and "Sign In with
// LinkedIn using OpenID Connect" for who the member is (learn.microsoft.com,
// read 2026-10-28). No PKCE: the flow documents none. NOT TESTED against
// LinkedIn: ansa has no developer app yet (IMPLEMENTATION_PLAN decision 7).

const AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
// openid + profile: who the member is (their id, for urn:li:person:<id>).
// w_member_social: post as them. The only self-serve scopes there are.
const SCOPES = ["openid", "profile", "w_member_social"];

// A refresh token comes only for LinkedIn's approved partners.
const tokenAnswerSchema = z.object({
  access_token: z.string().min(1).max(8000),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().min(1).max(8000).optional(),
  refresh_token_expires_in: z.number().int().positive().optional(),
  scope: z.string().max(2000).optional(),
});

const memberSchema = z.object({
  sub: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  name: z.string().optional(),
});

export const linkedInAdapter: SocialPlatformAdapter = {
  platform: "linkedin",
  usesPkce: false,
  scopes: SCOPES,
  buildAuthorizeUrl(request) {
    const query = { response_type: "code", client_id: request.clientId, redirect_uri: request.redirectUri, state: request.state, scope: SCOPES.join(" ") };
    return `${AUTHORIZE_URL}?${toQueryString(query)}`;
  },
  async completeAuthorization(request, context) {
    const exchange = formRequest({
      grant_type: "authorization_code",
      code: request.code,
      client_id: context.credentials.clientId,
      client_secret: context.credentials.clientSecret,
      redirect_uri: request.redirectUri,
    });
    const tokens = await requestTokens(exchange, context);
    const member = tokens ? await readMember(tokens.access_token, context) : null;
    if (!tokens || !member) {
      return { kind: "failed", code: "exchange_failed" };
    }
    const scopes = grantedScopes(tokens.scope, SCOPES);
    if (!scopes.includes("w_member_social")) {
      return { kind: "failed", code: "missing_permission" };
    }
    const account = {
      externalAccountId: member.sub,
      displayName: accountName(member.name, "LinkedIn member"),
      accountKind: "member" as const,
      scopes,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      accessExpiresAt: expiryFrom(tokens.expires_in, context.now),
      refreshExpiresAt: tokens.refresh_token ? expiryFrom(tokens.refresh_token_expires_in, context.now) : null,
    };
    return { kind: "authorized", accounts: [account] };
  },
  // Programmatic refresh, for LinkedIn's partners only: the same endpoint.
  async refreshTokens(refreshToken, context) {
    const refresh = formRequest({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: context.credentials.clientId,
      client_secret: context.credentials.clientSecret,
    });
    const answer = await sendToPlatform(context.fetchFn, TOKEN_URL, refresh, API_TIMEOUT_MS);
    if (answer.kind === "no_answer" || answer.response.status >= 500) {
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
    return {
      kind: "refreshed",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? refreshToken,
      accessExpiresAt: expiryFrom(tokens.expires_in, context.now),
      refreshExpiresAt: expiryFrom(tokens.refresh_token_expires_in, context.now),
    };
  },
  publish: publishLinkedInPost,
  // A member post's numbers need r_member_postAnalytics, a permission of
  // the Community Management API, which lives on an app of its own
  // (docs/research/social-publishing-apis.md, sections 1 and 5): ansa's
  // app can't ask for it, so LinkedIn is never asked (step 42).
  async fetchPostMetrics() {
    return { kind: "unavailable", code: "needs_permission" };
  },
  // LinkedIn documents no way to revoke a member's token: the member
  // removes ansa in their LinkedIn settings (the Accounts page says so).
  async revoke() {
    return { kind: "not_offered" };
  },
};

// The token endpoint's answer, or null when it refused or said nothing usable.
async function requestTokens(init: RequestInit, context: AdapterContext) {
  return readJsonIfOk(await sendToPlatform(context.fetchFn, TOKEN_URL, init, API_TIMEOUT_MS), tokenAnswerSchema);
}

// Who the member is: GET /v2/userinfo with their new token.
async function readMember(accessToken: string, context: AdapterContext) {
  const request = { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } };
  return readJsonIfOk(await sendToPlatform(context.fetchFn, USERINFO_URL, request, API_TIMEOUT_MS), memberSchema);
}
