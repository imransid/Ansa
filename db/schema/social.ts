import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
// Relative paths on purpose: drizzle-kit reads this file outside Next.js.
// The lists live in lib/ so the pages in the browser can read them too.
import type { SocialAccountKind, SocialConnectionStatus, SocialPlatform } from "../../lib/social-platforms";
import { users } from "./auth";
import { companies } from "./companies";

// A company's social accounts (step 40): what the Co-Founder may publish to
// (step 41). One row per platform account, made by an owner through the
// platform's consent screen (or, in development, the stand-in). Tokens are
// encrypted (lib/encryption.ts, socialTokenContext: company, connection and
// token kind) and never leave the server: no page, log, redirect or error
// holds one. Disconnecting removes them; the row stays for history.
export const socialConnections = pgTable(
  "social_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    platform: text("platform").$type<SocialPlatform>().notNull(),
    // The platform's own id of the account (a LinkedIn member's "sub", a
    // Facebook Page's id, an X user's id, a YouTube channel's id).
    // Reconnecting the same account updates its row.
    externalAccountId: text("external_account_id").notNull(),
    // The account's name as the platform gave it, one plain line.
    displayName: text("display_name").notNull(),
    accountKind: text("account_kind").$type<SocialAccountKind>().notNull(),
    // The permissions the platform granted, as it names them.
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    accessTokenEncrypted: text("access_token_encrypted"),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    // null: the platform gave no expiry (Facebook Page tokens, the stand-in).
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
    refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }),
    status: text("status").$type<SocialConnectionStatus>().notNull().default("connected"),
    // Why it needs reconnecting, or what went wrong when it was last used: a
    // code of lib/social-errors.ts, never a platform's message.
    lastError: text("last_error"),
    // The owner who connected it last.
    connectedByUserId: text("connected_by_user_id").notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // The development stand-in's account (adapters/dev-social.ts): never a
    // real platform, refused in production.
    isStandIn: boolean("is_stand_in").notNull().default(false),
    // When a run started renewing the tokens (services/social-tokens.ts);
    // null while none does. One run at a time: X may refuse a refresh token
    // once it was used, so a second run sending it at once could mark the
    // connection "needs reconnecting" while the first run's new tokens are
    // thrown away. A claim over a minute old is a run that died.
    renewalStartedAt: timestamp("renewal_started_at", { withTimezone: true }),
  },
  (table) => [
    // Reconnecting finds the same account again; a second company may connect it too.
    unique("social_connections_company_platform_account_unique").on(table.companyId, table.platform, table.externalAccountId),
    // Lets the publishing queue (step 41) point at a connection of the same company.
    unique("social_connections_company_id_id_unique").on(table.companyId, table.id),
    // Postgres refuses a person from another company.
    foreignKey({
      name: "social_connections_connector_in_same_company_fk",
      columns: [table.companyId, table.connectedByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    // The same lists as lib/social-platforms.ts (a check proves they agree).
    check("social_connections_platform_known", sql`${table.platform} IN ('linkedin', 'facebook', 'x', 'youtube')`),
    check("social_connections_account_kind_known", sql`${table.accountKind} IN ('member', 'page', 'channel', 'account')`),
    check("social_connections_status_known", sql`${table.status} IN ('connected', 'needs_reauth', 'disconnected')`),
    // What each platform's connection can be: a LinkedIn member (or, later,
    // one of its organization pages), a Facebook Page, an X account, a
    // YouTube channel.
    check(
      "social_connections_kind_fits_platform",
      sql`(${table.platform} = 'linkedin' AND ${table.accountKind} IN ('member', 'page')) OR (${table.platform} = 'facebook' AND ${table.accountKind} = 'page') OR (${table.platform} = 'x' AND ${table.accountKind} = 'account') OR (${table.platform} = 'youtube' AND ${table.accountKind} = 'channel')`,
    ),
    check("social_connections_external_account_id_format", sql`${table.externalAccountId} ~ '^[A-Za-z0-9_:.-]{1,200}$'`),
    // Only the stand-in has the stand-in's id (lib/social-platforms.ts).
    check("social_connections_stand_in_id", sql`${table.isStandIn} = (${table.externalAccountId} = 'dev:stand-in')`),
    check("social_connections_display_name_length", sql`char_length(${table.displayName}) BETWEEN 1 AND 200`),
    check("social_connections_scopes_count", sql`cardinality(${table.scopes}) <= 50`),
    // A code, never a message (which could quote a token or the account).
    check("social_connections_last_error_is_code", sql`${table.lastError} ~ '^[a-z0-9_]{1,60}$'`),
    // Connected means usable: a token, and not disconnected.
    check(
      "social_connections_connected_has_token",
      sql`${table.status} <> 'connected' OR (${table.accessTokenEncrypted} IS NOT NULL AND ${table.disconnectedAt} IS NULL)`,
    ),
    // Needing a reconnect says why.
    check("social_connections_needs_reauth_has_reason", sql`${table.status} <> 'needs_reauth' OR ${table.lastError} IS NOT NULL`),
    // Disconnected means no token is kept, and when it ended.
    check(
      "social_connections_disconnected_fields",
      sql`(${table.status} = 'disconnected') = (${table.disconnectedAt} IS NOT NULL) AND (${table.status} <> 'disconnected' OR (${table.accessTokenEncrypted} IS NULL AND ${table.refreshTokenEncrypted} IS NULL AND ${table.accessExpiresAt} IS NULL AND ${table.refreshExpiresAt} IS NULL))`,
    ),
    check("social_connections_refresh_expiry_with_token", sql`${table.refreshExpiresAt} IS NULL OR ${table.refreshTokenEncrypted} IS NOT NULL`),
    // Every change of status ends a renewal claim.
    check("social_connections_renewal_only_connected", sql`${table.renewalStartedAt} IS NULL OR ${table.status} = 'connected'`),
    // The Accounts page lists one company's connections per platform.
    index("social_connections_company_id_platform_idx").on(table.companyId, table.platform),
  ],
);

// One connection attempt (step 40): made when an owner presses Connect,
// used once when the platform sends them back, for 10 minutes. Only the
// state's SHA-256 hash is stored (lib/oauth-state.ts). Expired rows are
// deleted by the daily job (db/maintenance.ts).
export const oauthStates = pgTable(
  "oauth_states",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    // Who started it: only they can finish it.
    userId: text("user_id").notNull(),
    platform: text("platform").$type<SocialPlatform>().notNull(),
    stateHash: text("state_hash").notNull().unique(),
    // X and YouTube use PKCE (lib/oauth-state.ts); LinkedIn and Facebook don't.
    pkceVerifierEncrypted: text("pkce_verifier_encrypted"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Set by the one callback that used it (db/oauth-states.ts).
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "oauth_states_user_in_same_company_fk",
      columns: [table.companyId, table.userId],
      foreignColumns: [users.companyId, users.id],
    }),
    check("oauth_states_platform_known", sql`${table.platform} IN ('linkedin', 'facebook', 'x', 'youtube')`),
    check("oauth_states_state_hash_format", sql`${table.stateHash} ~ '^[0-9a-f]{64}$'`),
    // PKCE exactly where the platform supports it.
    check("oauth_states_pkce_where_supported", sql`(${table.platform} IN ('x', 'youtube')) = (${table.pkceVerifierEncrypted} IS NOT NULL)`),
    check(
      "oauth_states_lifetime",
      sql`${table.expiresAt} > ${table.createdAt} AND ${table.expiresAt} <= ${table.createdAt} + interval '10 minutes'`,
    ),
    check("oauth_states_used_after_created", sql`${table.usedAt} IS NULL OR ${table.usedAt} >= ${table.createdAt}`),
    // The daily job deletes the expired ones of every company.
    index("oauth_states_expires_at_idx").on(table.expiresAt),
  ],
);
