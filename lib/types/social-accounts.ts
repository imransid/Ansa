import type { SocialAccountKind, SocialConnectionStatus, SocialPlatform, SocialPlatformFacts } from "@/lib/social-platforms";

// What the Accounts page shows (step 40): per platform, what it can take,
// whether ansa has set it up, and the company's connected accounts. Never
// a token: the list has none.

// How long a connection's access lasts, as of now (connection-list.tsx
// words it). renews-itself: ansa renews it with the refresh token it
// keeps, until that one's own end when the platform named one. runs-out:
// nothing can renew it, so an owner reconnects before then. ran-out: that
// date has passed. none: it needs a reconnect for another reason, and the
// problem says why.
export type AccessLifetime =
  | { kind: "stand-in" }
  | { kind: "no-end-date" }
  | { kind: "renews-itself"; until: Date | null }
  | { kind: "runs-out"; on: Date }
  | { kind: "ran-out"; on: Date }
  | { kind: "none" };

export type ConnectionView = {
  id: string;
  displayName: string;
  accountKind: SocialAccountKind;
  // Past its end with nothing to renew it (a LinkedIn token after its 60
  // days, a refresh token after its own end), a connection shows as
  // needing a reconnect even before anything tried to use it.
  status: SocialConnectionStatus;
  problem: string | null;
  scopes: string[];
  lifetime: AccessLifetime;
  isStandIn: boolean;
  connectedAt: Date;
  connectedByName: string | null;
  disconnectedAt: Date | null;
};

export type PlatformView = {
  platform: SocialPlatform;
  label: string;
  mode: "real" | "stand-in" | "not-set-up";
  facts: SocialPlatformFacts;
  publishes: string;
  textLimit: string;
  scopesAsked: readonly string[];
  // Development only: the settings that would set it up. Never named in
  // production, where customers can't do anything about them.
  missingSettings: { id: string; secret: string } | null;
  connections: ConnectionView[];
  disconnected: ConnectionView[];
};

export type SocialAccountsPage = {
  canManage: boolean;
  // Development only: what each platform still needs from ansa, for ansa's
  // own operator (docs/research/social-publishing-apis.md).
  showsOperatorNotes: boolean;
  platforms: PlatformView[];
};
