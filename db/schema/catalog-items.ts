import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { companies } from "./companies";

// One restaurant's menu (step 46): one row per dish or drink, in the order
// the menu page shows them (position, lowest first). Named "catalog" so a
// shop's products fit later. Owners write it (db/menu.ts); anyone in the
// company marks a dish "Not available today". Plain text on purpose: the
// restaurant's own menu, written for its customers.
export const catalogItems = pgTable(
  "catalog_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    // The heading it is under ("" = none, shown under "Other dishes").
    category: text("category").notNull().default(""),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    // In the currency's smallest unit (cents for EUR, yen for JPY), in the
    // currency chosen in setup (assistant_settings.currency). lib/menu.ts.
    priceCents: integer("price_cents").notNull(),
    // "Not available today": until the end of the restaurant's day (its own
    // time zone), then the dish is available again by itself. null =
    // available. Read with the database's clock (db/menu.ts).
    unavailableUntil: timestamp("unavailable_until", { withTimezone: true }),
    position: integer("position").notNull(),
    createdByUserId: text("created_by_user_id"),
    updatedByUserId: text("updated_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The menu page reads a company's dishes in order.
    index("catalog_items_company_position_idx").on(table.companyId, table.position),
    // Postgres refuses someone from another company as who added or changed it.
    foreignKey({
      name: "catalog_items_creator_in_same_company_fk",
      columns: [table.companyId, table.createdByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    foreignKey({
      name: "catalog_items_updater_in_same_company_fk",
      columns: [table.companyId, table.updatedByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    // The limits of lib/menu.ts, as a safety net under Zod.
    check("catalog_items_category_length", sql`char_length(${table.category}) <= 60`),
    check("catalog_items_name_length", sql`char_length(${table.name}) BETWEEN 1 AND 120`),
    check("catalog_items_description_length", sql`char_length(${table.description}) <= 500`),
    check("catalog_items_price_range", sql`${table.priceCents} BETWEEN 0 AND 100000000`),
  ],
);
