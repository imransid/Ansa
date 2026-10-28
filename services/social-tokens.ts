import "server-only";
import { claimRenewal, getConnectionWithTokens, markNeedsReauth, recordConnectionProblem, saveRenewedTokens, type ConnectionWithTokens } from "@/db/social-connection-tokens";
import { decryptForDisplay, encryptText } from "@/lib/encryption";
import { socialTokenContext } from "@/lib/encryption-contexts";
import type { SocialPlatform } from "@/lib/social-platforms";
import { API_TIMEOUT_MS } from "@/lib/social-http";
import { refreshIfNeeded, type RefreshDecision } from "@/lib/social-publishing";
import type { PublishTarget } from "@/lib/social-types";
import { resolveSocialOptions, type ResolvedSocialOptions, type SocialOptions } from "./social-options";

// Getting a social connection ready before any call to its platform (step
// 40; the publishing queue, step 41, and metrics, step 42, call it): its
// token decrypted, and renewed first when it runs out within 5 minutes
// (refreshIfNeeded in lib/social-publishing.ts), by one run at a time (the
// renewal is claimed in /db first; another run waits for its new tokens),
// the new tokens saved in one UPDATE. A refusal to renew marks it "needs
// reconnecting" with a code; a platform that didn't answer leaves it usable
// and notes the code. The token only ever goes to the platform's adapter.

// While another run renews the tokens: how long to wait before looking
// again, and how many looks in all, more than the 15 seconds one renewal
// may take (lib/social-http.ts, API_TIMEOUT_MS).
const RENEWAL_WAIT_MS = 1000;
const MOST_LOOKS = 20;

// The longest getting a connection ready can take: every look but one
// waiting for another run's renewal, and one renewal of its own. The
// publishing queue counts it in a run's time budget (services/publish-runs.ts).
export const LONGEST_PREPARATION_MS = (MOST_LOOKS - 1) * RENEWAL_WAIT_MS + API_TIMEOUT_MS;

// storedAccessToken: the token as stored (encrypted) when it was read, so a
// later write about it (the platform refused it, step 41) changes the
// connection only while it still holds that token.
export type ConnectionForUse =
  | { kind: "ready"; platform: SocialPlatform; isStandIn: boolean; target: PublishTarget; storedAccessToken: string }
  | { kind: "needs_reauth"; code: string }
  // No usable token right now: try again later (nothing for an owner to do).
  | { kind: "unavailable"; code: string }
  | { kind: "disconnected" }
  | { kind: "not_found" };

// "changed": the stored tokens changed while this run renewed them. "wait":
// another run is renewing them.
type LookOutcome = ConnectionForUse | "changed" | "wait";

// One of the company's connections, ready to use, or why not.
export async function prepareConnectionForUse(companyId: string, connectionId: string, options: SocialOptions = {}): Promise<ConnectionForUse> {
  // WHY more than one look: when the stored tokens changed while this run
  // renewed them (another run renewed them first, or an owner reconnected),
  // the save matched nothing, and what is stored now is used instead; and
  // a run that finds another one renewing waits for its new tokens. Each
  // look reads the clock again: a wait moves it on.
  for (let look = 0; look < MOST_LOOKS; look++) {
    const resolved = resolveSocialOptions(options);
    const outcome = await prepareOnce(companyId, connectionId, resolved);
    if (outcome === "wait") {
      await resolved.sleep(RENEWAL_WAIT_MS);
    } else if (outcome !== "changed") {
      return outcome;
    }
  }
  return { kind: "unavailable", code: "refresh_unavailable" };
}

// One look at the stored connection: its token, renewed when it runs out soon.
async function prepareOnce(companyId: string, connectionId: string, options: ResolvedSocialOptions): Promise<LookOutcome> {
  const connection = await getConnectionWithTokens(companyId, connectionId);
  if (!connection) {
    return { kind: "not_found" };
  }
  const startedFrom = connection.accessTokenEncrypted;
  if (connection.status === "disconnected" || !startedFrom) {
    return { kind: "disconnected" };
  }
  if (connection.status === "needs_reauth") {
    return { kind: "needs_reauth", code: connection.lastError ?? "token_rejected" };
  }
  // The stored id, as Postgres gives it back: the tokens were encrypted for
  // it, and the id passed in may be written in capitals.
  const accessToken = decryptForDisplay(startedFrom, socialTokenContext(companyId, connection.id, "access"));
  const refreshToken = decryptForDisplay(connection.refreshTokenEncrypted, socialTokenContext(companyId, connection.id, "refresh"));
  if (!accessToken.text || refreshToken.unreadable) {
    // A wrong DATA_ENCRYPTION_KEY (logged by decryptForDisplay): nothing is
    // marked on the connection, since the key is the fix, not a reconnect.
    return { kind: "unavailable", code: "token_unreadable" };
  }
  const tokens = {
    platform: connection.platform,
    isStandIn: connection.isStandIn,
    accessToken: accessToken.text,
    refreshToken: refreshToken.text,
    accessExpiresAt: connection.accessExpiresAt,
    refreshExpiresAt: connection.refreshExpiresAt,
  };
  const decision = await refreshIfNeeded(tokens, options.modeOf(connection.platform), {
    fetchFn: options.fetchFn,
    now: options.now,
    claimRenewal: () => claimRenewal(companyId, connection.id, startedFrom),
  });
  return applyDecision(companyId, connection, accessToken.text, decision);
}

// Saves what the renewal decided, guarded by the token it started from.
async function applyDecision(companyId: string, connection: ConnectionWithTokens, accessToken: string, decision: RefreshDecision): Promise<LookOutcome> {
  const startedFrom = connection.accessTokenEncrypted ?? "";
  if (decision.kind === "fresh") {
    return ready(connection, accessToken, startedFrom);
  }
  if (decision.kind === "renewing_elsewhere") {
    // Even a token with minutes left waits: a publish may take longer.
    return "wait";
  }
  if (decision.kind === "needs_reauth") {
    const marked = await markNeedsReauth(companyId, connection.id, startedFrom, decision.code);
    return marked ? { kind: "needs_reauth", code: decision.code } : "changed";
  }
  if (decision.kind === "unavailable" && decision.code === "not_set_up") {
    // This server's matter, not the connection's: nothing is noted on it.
    return { kind: "unavailable", code: decision.code };
  }
  if (decision.kind === "unavailable") {
    const noted = await recordConnectionProblem(companyId, connection.id, startedFrom, decision.code);
    return noted ? { kind: "unavailable", code: decision.code } : "changed";
  }
  const renewed = {
    accessTokenEncrypted: encryptText(decision.accessToken, socialTokenContext(companyId, connection.id, "access")),
    refreshTokenEncrypted: decision.refreshToken ? encryptText(decision.refreshToken, socialTokenContext(companyId, connection.id, "refresh")) : null,
    accessExpiresAt: decision.accessExpiresAt,
    // A platform that names no new expiry leaves the known one.
    refreshExpiresAt: decision.refreshToken ? (decision.refreshExpiresAt ?? connection.refreshExpiresAt) : null,
  };
  const saved = await saveRenewedTokens(companyId, connection.id, startedFrom, renewed);
  return saved ? ready(connection, decision.accessToken, renewed.accessTokenEncrypted) : "changed";
}

// The connection ready to use, with the token that works now.
function ready(connection: ConnectionWithTokens, accessToken: string, storedAccessToken: string): ConnectionForUse {
  const target = { externalAccountId: connection.externalAccountId, accessToken };
  return { kind: "ready", platform: connection.platform, isStandIn: connection.isStandIn, target, storedAccessToken };
}
