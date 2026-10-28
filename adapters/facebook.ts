import "server-only";
import { z } from "zod";
import { accountName, API_TIMEOUT_MS, grantedScopes, readJsonIfOk, sendToPlatform, toQueryString } from "@/lib/social-http";
import type { AdapterContext, AuthorizedAccount, SocialPlatformAdapter } from "@/lib/social-types";
import { appSecretProof, GRAPH_API_VERSION, GRAPH_URL } from "./facebook-graph";
import { fetchFacebookPostMetrics } from "./facebook-metrics";
import { publishFacebookPost } from "./facebook-posts";

// Translates our social calls into Meta's Graph API for Facebook Pages
// (docs/research/social-publishing-apis.md, section 2; the login flow from
// developers.facebook.com's "Manually Build a Login Flow" and long-lived
// token pages, read 2026-10-28). One authorization gives one connection per
// Page the person may create content on, each with that Page's own token,
// which doesn't expire when it comes from a long-lived user token. The user
// token itself is never kept. No PKCE (the flow documents none). Publishing
// is in facebook-posts.ts, a post's numbers (step 42) in facebook-metrics.ts.
// NOT TESTED against Facebook: ansa has no Meta app yet (IMPLEMENTATION_PLAN
// decision 7).

const DIALOG_URL = `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`;
// What posting to a Page needs (the /feed and /photos references).
const SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts"];
// The Pages asked for at once. A person managing more is rare; the rest
// would need paging (a known gap in CLAUDE.md).
const PAGES_PER_REQUEST = 100;

const tokenAnswerSchema = z.object({ access_token: z.string().min(1).max(8000) });

const permissionsSchema = z.object({
  data: z.array(z.object({ permission: z.string().max(100), status: z.string().max(20) })).max(200),
});

const pagesSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().regex(/^\d{1,30}$/),
        name: z.string().optional(),
        access_token: z.string().min(1).max(8000).optional(),
        tasks: z.array(z.string().max(100)).max(50).optional(),
      }),
    )
    .max(PAGES_PER_REQUEST),
});

export const facebookAdapter: SocialPlatformAdapter = {
  platform: "facebook",
  usesPkce: false,
  scopes: SCOPES,
  buildAuthorizeUrl(request) {
    const query = { client_id: request.clientId, redirect_uri: request.redirectUri, state: request.state, response_type: "code", scope: SCOPES.join(",") };
    return `${DIALOG_URL}?${toQueryString(query)}`;
  },
  async completeAuthorization(request, context) {
    const { clientId, clientSecret } = context.credentials;
    // The code, then a short-lived user token ("hours") for a long-lived one ("about 60 days").
    const exchange = { client_id: clientId, redirect_uri: request.redirectUri, client_secret: clientSecret, code: request.code };
    const shortLived = await getToken(exchange, context);
    const longLived = shortLived
      ? await getToken({ grant_type: "fb_exchange_token", client_id: clientId, client_secret: clientSecret, fb_exchange_token: shortLived }, context)
      : null;
    if (!longLived) {
      return { kind: "failed", code: "exchange_failed" };
    }
    const granted = await readGrantedPermissions(longLived, context);
    const pages = await graphGet("/me/accounts", { fields: "id,name,access_token,tasks", limit: String(PAGES_PER_REQUEST) }, longLived, pagesSchema, context);
    if (!granted || !pages) {
      return { kind: "failed", code: "exchange_failed" };
    }
    // Posting to a Page needs all three (research, section 2).
    if (!SCOPES.every((scope) => granted.includes(scope))) {
      return { kind: "failed", code: "missing_permission" };
    }
    const accounts = pages.data.filter((page) => page.access_token && page.tasks?.includes("CREATE_CONTENT")).map((page) => pageAccount(page, granted));
    return accounts.length > 0 ? { kind: "authorized", accounts } : { kind: "failed", code: "no_pages" };
  },
  // Page tokens don't expire, and none comes with a refresh token.
  async refreshTokens() {
    return { kind: "refused" };
  },
  publish: publishFacebookPost,
  fetchPostMetrics: fetchFacebookPostMetrics,
  // Only a user token can take a Page's permission back, and ansa keeps
  // none: the owner removes ansa under Facebook's Business Integrations.
  async revoke() {
    return { kind: "not_offered" };
  },
};

// GET /oauth/access_token, as the docs write it: the parameters in the query.
async function getToken(params: Record<string, string>, context: AdapterContext): Promise<string | null> {
  const answer = await sendToPlatform(context.fetchFn, `${GRAPH_URL}/oauth/access_token?${toQueryString(params)}`, { method: "GET" }, API_TIMEOUT_MS);
  return (await readJsonIfOk(answer, tokenAnswerSchema))?.access_token ?? null;
}

// One GET of the Graph API with a token (and its appsecret_proof), read through schema.
async function graphGet<T>(path: string, params: Record<string, string>, accessToken: string, schema: z.ZodType<T>, context: AdapterContext): Promise<T | null> {
  const query = toQueryString({ ...params, access_token: accessToken, appsecret_proof: appSecretProof(accessToken, context.credentials.clientSecret) });
  const answer = await sendToPlatform(context.fetchFn, `${GRAPH_URL}${path}?${query}`, { method: "GET" }, API_TIMEOUT_MS);
  return readJsonIfOk(answer, schema);
}

// The permissions the person left ticked (Facebook lets them untick some).
async function readGrantedPermissions(accessToken: string, context: AdapterContext): Promise<string[] | null> {
  const permissions = await graphGet("/me/permissions", {}, accessToken, permissionsSchema, context);
  return permissions ? permissions.data.filter((entry) => entry.status === "granted").map((entry) => entry.permission) : null;
}

function pageAccount(page: z.infer<typeof pagesSchema>["data"][number], granted: string[]): AuthorizedAccount {
  return {
    externalAccountId: page.id,
    displayName: accountName(page.name, "Facebook Page"),
    accountKind: "page",
    scopes: grantedScopes(granted.join(" "), SCOPES),
    accessToken: page.access_token ?? "",
    refreshToken: null,
    accessExpiresAt: null,
    refreshExpiresAt: null,
  };
}
