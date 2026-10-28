import "server-only";
import { randomUUID } from "node:crypto";
import { standInAccount } from "@/adapters/dev-social";
import { createOauthState } from "@/db/oauth-states";
import { canManageSocialAccounts } from "@/lib/cofounder/permissions";
import { encryptText } from "@/lib/encryption";
import { oauthPkceVerifierContext } from "@/lib/encryption-contexts";
import type { FormErrors, FormResult } from "@/lib/form-result";
import { hashOauthState, newOauthState, newPkceVerifier, pkceChallengeOf } from "@/lib/oauth-state";
import type { SessionContext } from "@/lib/session";
import { standInsAllowed } from "@/lib/social-mode";
import { SOCIAL_PLATFORM_LABELS } from "@/lib/social-platforms";
import { adapterFor, buildAuthorizeUrl } from "@/lib/social-publishing";
import { socialPlatformInputSchema } from "@/lib/validation/social";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";
import { saveAuthorizedAccounts } from "./social-account-saving";
import { resolveSocialOptions, type SocialOptions } from "./social-options";

// Connecting a social account (step 40). Real: the attempt is saved (the
// state's hash, the PKCE verifier encrypted) and the owner is sent to the
// platform's consent screen; services/social-oauth-callback.ts finishes it.
// On a development server without the platform's app, a stand-in account
// is connected at once instead. Reconnecting is connecting again.

export type StartConnectionResult = { ok: true; url: string } | { ok: false; errors: FormErrors };

const ONLY_OWNERS = { ok: false as const, errors: { message: "Only owners can connect accounts." } };
const TOO_MANY = { ok: false as const, errors: { message: "Too many attempts. Try again in a few minutes." } };

// Starts connecting one platform for the session's company: the address of
// the platform's consent screen to send the owner to. Owners only.
export async function startSocialConnectionForSession(session: SessionContext, input: unknown, options: SocialOptions = {}): Promise<StartConnectionResult> {
  const parsed = socialPlatformInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "Pick a platform." } };
  }
  const refusal = await ownerAndLimitRefusal(session);
  if (refusal) {
    return refusal;
  }
  const { platform } = parsed.data;
  const mode = resolveSocialOptions(options).modeOf(platform);
  if (mode.kind !== "real") {
    const where = mode.kind === "stand-in" ? "on this development server: connect a stand-in account instead" : "by ansa yet";
    return { ok: false, errors: { message: `${SOCIAL_PLATFORM_LABELS[platform]} isn't set up ${where}.` } };
  }
  const state = newOauthState();
  const stateId = randomUUID();
  const verifier = adapterFor(platform).usesPkce ? newPkceVerifier() : null;
  const saved = await createOauthState(session.companyId, session.userId, {
    id: stateId,
    platform,
    stateHash: hashOauthState(state),
    pkceVerifierEncrypted: verifier ? encryptText(verifier, oauthPkceVerifierContext(session.companyId, stateId)) : null,
  });
  if (saved === "not-allowed") {
    return ONLY_OWNERS;
  }
  return { ok: true, url: buildAuthorizeUrl(platform, mode.credentials, { state, codeChallenge: verifier ? pkceChallengeOf(verifier) : null }) };
}

// Connects one platform's stand-in account for the session's company (no
// consent screen, adapters/dev-social.ts): only on a development server
// without that platform's app. Connecting it again renews it. Owners only.
export async function connectStandInAccountForSession(session: SessionContext, input: unknown, options: SocialOptions = {}): Promise<FormResult> {
  const parsed = socialPlatformInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "Pick a platform." } };
  }
  const refusal = await ownerAndLimitRefusal(session);
  if (refusal) {
    return refusal;
  }
  const { platform } = parsed.data;
  const resolved = resolveSocialOptions(options);
  if (!standInsAllowed(resolved.nodeEnv) || resolved.modeOf(platform).kind !== "stand-in") {
    return { ok: false, errors: { message: "A stand-in account can only be connected on a development server without the platform's app." } };
  }
  const outcome = await saveAuthorizedAccounts(session.companyId, session.userId, platform, [standInAccount(platform, adapterFor(platform).scopes)], true);
  if (outcome === "not-allowed") {
    return ONLY_OWNERS;
  }
  return outcome === "saved" ? { ok: true } : { ok: false, errors: { message: "Someone connected it at the same moment. Try again." } };
}

// Refuses members, and counts one attempt against the person's limit.
async function ownerAndLimitRefusal(session: SessionContext): Promise<{ ok: false; errors: FormErrors } | null> {
  if (!canManageSocialAccounts(session.role)) {
    return ONLY_OWNERS;
  }
  if (await isOverRateLimit("social-accounts", session.userId, RATE_LIMITS.socialAccountChangesPerUser)) {
    return TOO_MANY;
  }
  return null;
}
