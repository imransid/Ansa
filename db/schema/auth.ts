import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";

// The four tables below are the ones Better Auth expects.
// Property names (emailVerified, userId, ...) must match Better Auth's field
// names exactly. Column names in the database are snake_case.
// Only `users` belongs to a company. sessions, accounts and verifications
// are keyed by user and are managed by Better Auth.

export const userRoles = ["owner", "member"] as const;
export const userRoleEnum = pgEnum("user_role", userRoles);
export type UserRole = (typeof userRoles)[number];

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    // One user belongs to exactly one company.
    // onDelete "restrict" so deleting a company never silently deletes its people.
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    role: userRoleEnum("role").notNull(),
    name: text("name").notNull(),
    // Unique across all companies, because one email = one user = one company.
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    // Set = an owner removed this person from the team (db/team-members.ts).
    // The row stays so tickets keep showing who worked on them, but the person
    // can't log in, is logged out everywhere, and never gets tickets again.
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("users_company_id_idx").on(table.companyId),
    // id is already unique on its own. This pair exists so other tables can use
    // a foreign key on (company_id, user_id), which makes Postgres itself refuse
    // to link a row to a user from a different company. See tickets.ts.
    unique("users_company_id_id_unique").on(table.companyId, table.id),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

// An "account" is a way to log in. For email/password users it holds the
// password hash (providerId = "credential").
export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("accounts_user_id_idx").on(table.userId)],
);

// Better Auth's short-lived tokens: password reset links (step 22), stored only
// as a SHA-256 hash (lib/auth.ts). Email confirmation links are signed tokens
// and never stored here. The daily cleanup deletes expired rows (db/maintenance.ts).
export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);
