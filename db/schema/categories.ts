import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { companies } from "./companies";

// A kind of problem a company's experts handle ("Billing", "Shipping", ...).
// Managed by owners on the Team page. Never deleted, only archived, so old
// tickets keep their category.
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    // Set = archived: kept for old tickets, but can't be picked any more.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // tickets.category points here by (company_id, name), see tickets.ts.
    unique("categories_company_id_name_unique").on(table.companyId, table.name),
    // "Billing" and "billing" may not both exist in one company.
    uniqueIndex("categories_company_id_lower_name_unique").on(table.companyId, sql`lower(${table.name})`),
    // Lets user_categories use a (company_id, category_id) foreign key.
    unique("categories_company_id_id_unique").on(table.companyId, table.id),
  ],
);

// Which categories each person handles. Routing (db/routing.ts) only picks
// experts from here.
export const userCategories = pgTable(
  "user_categories",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    userId: text("user_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ name: "user_categories_pk", columns: [table.userId, table.categoryId] }),
    index("user_categories_company_id_category_id_idx").on(table.companyId, table.categoryId),
    // Postgres refuses a person or a category from another company.
    foreignKey({
      name: "user_categories_user_in_same_company_fk",
      columns: [table.companyId, table.userId],
      foreignColumns: [users.companyId, users.id],
    }),
    foreignKey({
      name: "user_categories_category_in_same_company_fk",
      columns: [table.companyId, table.categoryId],
      foreignColumns: [categories.companyId, categories.id],
    }),
  ],
);
