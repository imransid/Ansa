import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { userRoleEnum, users } from "./auth";
import { companies } from "./companies";

// An invite link for one email address to join one company with one role.
// An invite is pending until it is accepted, revoked, or expires.
export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    // Only this email can use the invite. Stored lowercase.
    email: text("email").notNull(),
    role: userRoleEnum("role").notNull(),
    // SHA-256 of the token in the link. The token itself is never stored,
    // so someone reading the database cannot use pending invites.
    tokenHash: text("token_hash").notNull().unique(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("invites_company_id_idx").on(table.companyId)],
);
