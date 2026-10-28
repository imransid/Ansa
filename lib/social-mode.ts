import "server-only";
import { env, type Env } from "@/lib/env";
import { SOCIAL_CREDENTIAL_SETTINGS, type SocialPlatform } from "@/lib/social-platforms";

// Whether this server can connect each social platform (step 40), the
// "off / stand-in / real" pattern of Billing (services/billing.ts):
// "real": ansa's developer app is set (both settings of lib/env.ts), so
//   owners connect through the platform's own consent screen.
// "stand-in": development without the app: the Accounts page offers a
//   stand-in account (adapters/dev-social.ts) so every step can be tried.
// "not-set-up": production without the app: the page says ansa hasn't set
//   it up yet, and nothing is offered. The stand-in is never used there.

export type PlatformCredentials = { clientId: string; clientSecret: string };

export type PlatformMode = { kind: "real"; credentials: PlatformCredentials } | { kind: "stand-in" } | { kind: "not-set-up" };

// The settings this file reads, so the checks can pass made-up ones.
export type SocialCredentialSettings = Pick<Env, (typeof SOCIAL_CREDENTIAL_SETTINGS)[SocialPlatform]["id" | "secret"]>;

// Which mode one platform is in, from the settings and the NODE_ENV the
// server runs with. Takes both as arguments so the checks can try
// production without running in it.
export function platformModeFor(platform: SocialPlatform, settings: SocialCredentialSettings, nodeEnv: string | undefined): PlatformMode {
  const { id, secret } = SOCIAL_CREDENTIAL_SETTINGS[platform];
  const clientId = settings[id];
  const clientSecret = settings[secret];
  if (clientId && clientSecret) {
    return { kind: "real", credentials: { clientId, clientSecret } };
  }
  return isProduction(nodeEnv) ? { kind: "not-set-up" } : { kind: "stand-in" };
}

// The mode for this server's own settings (see platformModeFor).
export function currentPlatformMode(platform: SocialPlatform): PlatformMode {
  return platformModeFor(platform, env, process.env.NODE_ENV);
}

// Whether a stand-in account may be connected or published through.
// Never in production (IMPLEMENTATION_PLAN decision 6), whatever is set.
export function standInsAllowed(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return !isProduction(nodeEnv);
}

// Where a platform sends the owner back after its consent screen. The
// authorize request and the code exchange must send the very same address,
// and it is registered with the platform's developer app
// (docs/going-live.md, section 10).
export function socialCallbackUrl(platform: SocialPlatform, baseUrl: string = env.BETTER_AUTH_URL): string {
  return new URL(`/api/social/${platform}/callback`, baseUrl).toString();
}

function isProduction(nodeEnv: string | undefined): boolean {
  return nodeEnv === "production";
}
