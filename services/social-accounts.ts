import "server-only";
import { listSocialConnections, type SocialConnectionListItem } from "@/db/social-connections";
import { canManageSocialAccounts } from "@/lib/cofounder/permissions";
import { PLATFORM_RULES } from "@/lib/content-rules";
import { CONTENT_FORMAT_PLURALS } from "@/lib/content-studio/formats";
import { COUNTING_UNITS } from "@/lib/content-studio/text-measure";
import type { SessionContext } from "@/lib/session";
import { describeConnectionError } from "@/lib/social-errors";
import { standInsAllowed } from "@/lib/social-mode";
import {
  PUBLISHED_FORMATS,
  SOCIAL_CREDENTIAL_SETTINGS,
  SOCIAL_PLATFORM_FACTS,
  SOCIAL_PLATFORM_LABELS,
  socialPlatforms,
  type SocialAccountKind,
  type SocialConnectionStatus,
  type SocialPlatform,
  type SocialPlatformFacts,
} from "@/lib/social-platforms";
import { adapterFor } from "@/lib/social-publishing";
import { resolveSocialOptions, type SocialOptions } from "./social-options";

// What the Accounts page shows (step 40): per platform, what it can take,
// whether ansa has set it up, and the company's connected accounts. Never
// a token: the list has none (db/social-connections.ts).

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

// The session company's Accounts page.
export async function getSocialAccountsPageForSession(session: SessionContext, options: SocialOptions = {}): Promise<SocialAccountsPage> {
  const resolved = resolveSocialOptions(options);
  const rows = await listSocialConnections(session.companyId);
  const platforms = socialPlatforms.map((platform): PlatformView => {
    const mode = resolved.modeOf(platform).kind;
    const views = rows.filter((row) => row.platform === platform).map((row) => toView(row, resolved.now));
    return {
      platform,
      label: SOCIAL_PLATFORM_LABELS[platform],
      mode,
      facts: SOCIAL_PLATFORM_FACTS[platform],
      publishes: describePublishedFormats(platform),
      textLimit: describeTextLimit(platform),
      scopesAsked: adapterFor(platform).scopes,
      missingSettings: mode === "stand-in" ? SOCIAL_CREDENTIAL_SETTINGS[platform] : null,
      connections: views.filter((view) => view.status !== "disconnected").sort(byStatusThenName),
      disconnected: views.filter((view) => view.status === "disconnected"),
    };
  });
  return { canManage: canManageSocialAccounts(session.role), showsOperatorNotes: standInsAllowed(resolved.nodeEnv), platforms };
}

// A connection's status as of now: what the next use would find
// (lib/social-publishing.ts, refreshIfNeeded). One past its end with
// nothing to renew it needs a reconnect even before anything tried to use
// it. The Accounts page and the dashboard's overview (step 43) both read it.
export function connectionStatusAsOfNow(row: SocialConnectionListItem, now: Date): SocialConnectionStatus {
  return hasRunOut(row, now) ? "needs_reauth" : row.status;
}

// One connection as the page shows it, its status as of now.
function toView(row: SocialConnectionListItem, now: Date): ConnectionView {
  const ranOut = hasRunOut(row, now);
  const status = connectionStatusAsOfNow(row, now);
  const problemCode = ranOut ? (row.hasRefreshToken ? "refresh_expired" : "token_expired") : row.lastError;
  return {
    id: row.id,
    displayName: row.displayName,
    accountKind: row.accountKind,
    status,
    problem: problemCode ? describeConnectionError(problemCode, SOCIAL_PLATFORM_LABELS[row.platform]) : null,
    scopes: row.scopes,
    lifetime: lifetimeOf(row, status, renewsItself(row, now), now),
    isStandIn: row.isStandIn,
    connectedAt: row.connectedAt,
    connectedByName: row.connectedByName,
    disconnectedAt: row.disconnectedAt,
  };
}

// A refresh token past its own end (Google's 7 days while ansa's app is in
// Testing) renews nothing.
function renewsItself(row: SocialConnectionListItem, now: Date): boolean {
  return row.hasRefreshToken && (row.refreshExpiresAt === null || row.refreshExpiresAt > now);
}

// Connected, but its access ended and nothing can renew it.
function hasRunOut(row: SocialConnectionListItem, now: Date): boolean {
  return row.status === "connected" && !renewsItself(row, now) && row.accessExpiresAt !== null && row.accessExpiresAt <= now;
}

// How long the access lasts as of now, for the page to word.
function lifetimeOf(row: SocialConnectionListItem, status: SocialConnectionStatus, renewsItself: boolean, now: Date): AccessLifetime {
  const endsAt = row.accessExpiresAt;
  if (row.isStandIn) {
    return { kind: "stand-in" };
  }
  if (status !== "connected") {
    // The problem says why; an end that has passed is all there is to add.
    return endsAt !== null && endsAt <= now && !renewsItself ? { kind: "ran-out", on: endsAt } : { kind: "none" };
  }
  if (endsAt === null) {
    return { kind: "no-end-date" };
  }
  return renewsItself ? { kind: "renews-itself", until: row.refreshExpiresAt } : { kind: "runs-out", on: endsAt };
}

// Connected ones first, then those needing a reconnect; each by name.
function byStatusThenName(first: ConnectionView, second: ConnectionView): number {
  if (first.status !== second.status) {
    return first.status === "connected" ? -1 : 1;
  }
  return first.displayName.localeCompare(second.displayName);
}

// "Text posts and posts with an image", or "Videos only".
function describePublishedFormats(platform: SocialPlatform): string {
  const names = PUBLISHED_FORMATS[platform].map((format) => CONTENT_FORMAT_PLURALS[format]);
  const sentence = names.length === 1 ? `${names[0]} only` : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

// From the content studio's rules (lib/content-rules.ts), so both agree.
function describeTextLimit(platform: SocialPlatform): string {
  const rules = PLATFORM_RULES[platform];
  const text = `${rules.text.label}: up to ${rules.text.max.toLocaleString("en-US")} ${COUNTING_UNITS[rules.text.counting]}`;
  return rules.title ? `Title: up to ${rules.title.max} characters. ${text}.` : `${text}.`;
}
