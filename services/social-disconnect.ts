import "server-only";
import { disconnectSocialConnection } from "@/db/social-connection-disconnects";
import { isAccountConnectedAnywhere } from "@/db/social-account-connected";
import { canManageSocialAccounts } from "@/lib/cofounder/permissions";
import { decryptForDisplay } from "@/lib/encryption";
import { socialTokenContext } from "@/lib/encryption-contexts";
import type { FormResult } from "@/lib/form-result";
import type { SessionContext } from "@/lib/session";
import { REVOKES_ON_REQUEST, type SocialPlatform } from "@/lib/social-platforms";
import { revokeAccess } from "@/lib/social-publishing";
import { socialConnectionInputSchema } from "@/lib/validation/social";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";
import { resolveSocialOptions, type ResolvedSocialOptions, type SocialOptions } from "./social-options";
import type { RunAfterResponse } from "./vapi-webhook";

// Disconnecting a social account (step 40): its tokens are deleted at once
// and the row stays, as "disconnected", for history. Right after the
// answer, the platform is asked to take ansa's access back where it offers
// that (REVOKES_ON_REQUEST: X and Google; LinkedIn and Facebook Pages
// can't, and the page tells the owner where to remove ansa instead),
// unless the account is still connected anywhere (another company has it
// too): X's and Google's grant is the account's with ansa's one app, so
// the revoke would end that connection too. Best effort: a failed revoke
// is one fixed log line, and the account is disconnected either way.

type RemovedTokens = {
  platform: SocialPlatform;
  externalAccountId: string;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
};

// Disconnects one of the session company's social accounts. Owners only.
export async function disconnectSocialAccountForSession(
  session: SessionContext,
  input: unknown,
  runAfterResponse: RunAfterResponse,
  options: SocialOptions = {},
): Promise<FormResult> {
  const parsed = socialConnectionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "That account was not found in your company." } };
  }
  const onlyOwners: FormResult = { ok: false, errors: { message: "Only owners can disconnect accounts." } };
  if (!canManageSocialAccounts(session.role)) {
    return onlyOwners;
  }
  if (await isOverRateLimit("social-accounts", session.userId, RATE_LIMITS.socialAccountChangesPerUser)) {
    return { ok: false, errors: { message: "Too many attempts. Try again in a few minutes." } };
  }
  const { connectionId } = parsed.data;
  const result = await disconnectSocialConnection(session.companyId, session.userId, connectionId);
  if (result.outcome === "not-allowed") {
    return onlyOwners;
  }
  if (result.outcome === "not-found") {
    return { ok: false, errors: { message: "That account was not found in your company." } };
  }
  // "already-disconnected": someone else did it a moment ago; the page shows it so.
  if (result.outcome === "disconnected" && !result.isStandIn && REVOKES_ON_REQUEST.includes(result.platform)) {
    const resolved = resolveSocialOptions(options);
    runAfterResponse(() => revokeRemovedTokens(session.companyId, connectionId, result, resolved));
  }
  return { ok: true };
}

// Asks the platform to take back the tokens a disconnect removed, unless
// the account is still connected (another company has it too).
async function revokeRemovedTokens(companyId: string, connectionId: string, removed: RemovedTokens, options: ResolvedSocialOptions): Promise<void> {
  try {
    if (await isAccountConnectedAnywhere(removed.platform, removed.externalAccountId)) {
      // The last company to disconnect it has it revoked.
      console.info(`Social revoke skipped: ${removed.platform} account still connected`);
      return;
    }
    const accessToken = decryptForDisplay(removed.accessTokenEncrypted, socialTokenContext(companyId, connectionId, "access")).text;
    const refreshToken = decryptForDisplay(removed.refreshTokenEncrypted, socialTokenContext(companyId, connectionId, "refresh")).text;
    const revoked = await revokeAccess({ platform: removed.platform, isStandIn: false }, { accessToken, refreshToken }, options.modeOf(removed.platform), options);
    if (revoked.kind === "failed") {
      console.warn(`Social revoke failed: ${removed.platform} ${revoked.code}`);
    }
  } catch (error) {
    // The class only: a platform's error could quote the token.
    console.error(`Social revoke failed: ${removed.platform} ${error instanceof Error ? error.constructor.name : "unknown"}`);
  }
}
