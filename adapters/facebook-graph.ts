import "server-only";
import { createHmac } from "node:crypto";
import { z } from "zod";

// What the Facebook files (facebook.ts: connecting, facebook-posts.ts:
// publishing, facebook-metrics.ts: a post's numbers) send every Graph API
// call with, and how they read its errors.

// One Graph API version for every call (v26.0 since 2026-07-29; v25.0 runs
// until 2028-07-29, docs/research/social-publishing-apis.md, section 2).
export const GRAPH_API_VERSION = "v26.0";
export const GRAPH_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// Only the codes are read; the message (and fbtrace_id) never are.
export const graphErrorSchema = z.object({ error: z.object({ code: z.number().int(), error_subcode: z.number().int().optional() }) });

// The error-handling guide's throttling codes: wait, then try again.
export const THROTTLED_CODES = [4, 17, 32, 341, 613, 80001];

// Meta's "appsecret_proof": the token signed with ansa's app secret, sent
// with every call made with a token, so a token copied elsewhere is useless
// without the secret once the app requires it (docs/going-live.md, section 10).
export function appSecretProof(accessToken: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(accessToken).digest("hex");
}
