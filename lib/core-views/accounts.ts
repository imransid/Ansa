import "server-only";
import { callCore, type CoreAnswer } from "@/lib/core-api";
import { toFormErrors } from "@/lib/core-views/auth";
import type { FormErrors, FormResult } from "@/lib/form-result";
import { buildLoginUrl } from "@/lib/login-redirect";
import type { SessionContext } from "@/lib/session";
import { SOCIAL_PLATFORM_FACTS, type SocialPlatform } from "@/lib/social-platforms";
import { socialConnectionInputSchema, socialPlatformSchema } from "@/lib/validation/social";
import type { AccessLifetime, ConnectionView, PlatformView, SocialAccountsPage } from "@/services/social-accounts";

// The company's social accounts through the new backend (core's
// /api/v1/social and /api/v1/cofounder/accounts), every platform: the
// Accounts page (also Settings → Connections' posting platforms), Connect
// (or a development stand-in), Disconnect, and the owner's return from a
// platform's consent screen. Never a token: core's answers hold none.

const ACCOUNTS_PAGE = "/cofounder/accounts";

type CoreLifetime = { kind: AccessLifetime["kind"]; until: string | null; on: string | null };

// A connection as core sends it: its times as ISO strings.
type CoreConnection = Omit<ConnectionView, "lifetime" | "connectedAt" | "disconnectedAt"> & {
  lifetime: CoreLifetime;
  connectedAt: string;
  disconnectedAt: string | null;
};

type CorePlatform = Omit<PlatformView, "facts" | "connections" | "disconnected"> & {
  connections: CoreConnection[];
  disconnected: CoreConnection[];
};

type CoreAccountsPage = { page: { canManage: boolean; showsOperatorNotes: boolean; platforms: CorePlatform[] } };

function dateOrNull(iso: string | null): Date | null {
  return iso ? new Date(iso) : null;
}

function toLifetime(lifetime: CoreLifetime): AccessLifetime {
  switch (lifetime.kind) {
    case "stand-in":
      return { kind: "stand-in" };
    case "no-end-date":
      return { kind: "no-end-date" };
    case "renews-itself":
      return { kind: "renews-itself", until: dateOrNull(lifetime.until) };
    case "runs-out":
      return lifetime.on ? { kind: "runs-out", on: new Date(lifetime.on) } : { kind: "none" };
    case "ran-out":
      return lifetime.on ? { kind: "ran-out", on: new Date(lifetime.on) } : { kind: "none" };
    default:
      return { kind: "none" };
  }
}

function toConnection(connection: CoreConnection): ConnectionView {
  return {
    id: connection.id,
    displayName: connection.displayName,
    accountKind: connection.accountKind,
    status: connection.status,
    problem: connection.problem,
    scopes: connection.scopes ?? [],
    lifetime: toLifetime(connection.lifetime),
    isStandIn: connection.isStandIn,
    connectedAt: new Date(connection.connectedAt),
    connectedByName: connection.connectedByName,
    disconnectedAt: dateOrNull(connection.disconnectedAt),
  };
}

function toPlatform(platform: CorePlatform): PlatformView {
  return {
    platform: platform.platform,
    label: platform.label,
    mode: platform.mode,
    // What the platform takes and still needs from ansa: the screens' own words.
    facts: SOCIAL_PLATFORM_FACTS[platform.platform],
    publishes: platform.publishes,
    textLimit: platform.textLimit,
    scopesAsked: platform.scopesAsked,
    missingSettings: platform.missingSettings,
    connections: platform.connections.map(toConnection),
    disconnected: platform.disconnected.map(toConnection),
  };
}

// Per platform: what it takes, whether ansa has set it up, and the
// company's accounts (each as of now); whether this person connects (owners).
export async function getAccountsPageFromCore(): Promise<SocialAccountsPage> {
  const answer = await callCore<CoreAccountsPage>("GET", "/api/v1/cofounder/accounts");
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  const { page } = answer.data;
  return { canManage: page.canManage, showsOperatorNotes: page.showsOperatorNotes, platforms: page.platforms.map(toPlatform) };
}

// A platform from a form or an address: one ansa connects, else core is
// never asked (and it never becomes a path of its own).
function readPlatform(value: unknown): SocialPlatform | null {
  const parsed = socialPlatformSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const PICK_A_PLATFORM = { ok: false as const, errors: { message: "Pick a platform." } };

function savedOrErrors(answer: CoreAnswer<unknown>): FormResult {
  return answer.ok ? { ok: true } : { ok: false, errors: toFormErrors(answer) };
}

// Connect: the address of the platform's consent screen to send the owner to.
export async function startSocialConnectThroughCore(platformValue: unknown): Promise<{ ok: true; url: string } | { ok: false; errors: FormErrors }> {
  const platform = readPlatform(platformValue);
  if (!platform) {
    return PICK_A_PLATFORM;
  }
  const answer = await callCore<{ url: string }>("POST", `/api/v1/social/${platform}/connect`);
  if (!answer.ok) {
    return { ok: false, errors: toFormErrors(answer) };
  }
  // The browser is sent there: only ever an https address.
  return answer.data.url.startsWith("https://") ? { ok: true, url: answer.data.url } : { ok: false, errors: { message: "Something went wrong. Try again in a moment." } };
}

// Development without the platform's app: its stand-in account, connected at once.
export async function connectStandInThroughCore(platformValue: unknown): Promise<FormResult> {
  const platform = readPlatform(platformValue);
  if (!platform) {
    return PICK_A_PLATFORM;
  }
  return savedOrErrors(await callCore("POST", `/api/v1/social/${platform}/stand-in`));
}

// Disconnects one of the company's accounts, whatever its platform; core
// asks X and Google to take ansa's access back after its answer.
export async function disconnectAccountThroughCore(connectionId: unknown): Promise<FormResult> {
  const parsed = socialConnectionInputSchema.safeParse({ connectionId });
  if (!parsed.success) {
    return { ok: false, errors: { message: "That account was not found in your company." } };
  }
  return savedOrErrors(await callCore("POST", `/api/v1/social/connections/${parsed.data.connectionId}/disconnect`));
}

// The owner's return from a platform's consent screen: core finishes it
// and names the Accounts page address (with its result code) to send them
// to. 404 for a platform ansa doesn't connect; the login page without a
// session (the attempt can't be finished without its owner, and expires).
export async function finishSocialConnectionThroughCore(session: SessionContext | null, platformParam: string, query: URLSearchParams): Promise<Response> {
  const platform = readPlatform(platformParam);
  if (!platform) {
    return new Response(null, { status: 404 });
  }
  if (!session) {
    return redirectTo(buildLoginUrl(ACCOUNTS_PAGE));
  }
  // URLSearchParams writes the query fully encoded, so fetch sends it as
  // signed (core checks the signature on the address it receives). No "?"
  // without a query: fetch would drop it, and the signature with it.
  const search = query.toString();
  const answer = await callCore<{ location: string }>("GET", `/api/v1/social/${platform}/callback${search ? `?${search}` : ""}`);
  if (!answer.ok && answer.status === 401) {
    return redirectTo(buildLoginUrl(ACCOUNTS_PAGE));
  }
  // Only ever the Accounts page, whatever came back.
  const isAccountsPage = answer.ok && answer.data.location.startsWith(`${ACCOUNTS_PAGE}?`);
  return redirectTo(isAccountsPage ? answer.data.location : `${ACCOUNTS_PAGE}?result=exchange_failed&platform=${platform}`);
}

function redirectTo(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}
