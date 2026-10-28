import "server-only";
import { env } from "@/lib/env";
import { platformModeFor, type PlatformMode } from "@/lib/social-mode";
import type { SocialPlatform } from "@/lib/social-platforms";
import type { SocialFetch } from "@/lib/social-types";

// What the social account services (step 40) take from outside, so the
// checks can try every mode against fake platforms. Real code passes
// nothing: this server's settings, the real fetch, the clock, real waits.
export type SocialOptions = {
  // Each platform's mode (lib/social-mode.ts).
  modeOf?: (platform: SocialPlatform) => PlatformMode;
  fetchFn?: SocialFetch;
  now?: Date;
  // "production" refuses every stand-in.
  nodeEnv?: string;
  // How a run waits for another run's renewal (services/social-tokens.ts).
  // Only the checks replace it, so they don't wait.
  sleep?: (milliseconds: number) => Promise<void>;
};

export type ResolvedSocialOptions = {
  modeOf: (platform: SocialPlatform) => PlatformMode;
  fetchFn: SocialFetch;
  now: Date;
  nodeEnv: string | undefined;
  sleep: (milliseconds: number) => Promise<void>;
};

// The options with this server's own for whatever wasn't passed.
export function resolveSocialOptions(options: SocialOptions): ResolvedSocialOptions {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  return {
    modeOf: options.modeOf ?? ((platform) => platformModeFor(platform, env, nodeEnv)),
    fetchFn: options.fetchFn ?? fetch,
    now: options.now ?? new Date(),
    nodeEnv,
    sleep: options.sleep ?? waitFor,
  };
}

// A real pause: what every run but the checks' waits with.
function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
