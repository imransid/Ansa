import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
// A relative path on purpose: drizzle-kit reads this file outside Next.js.
import type { Fulfilment, OrderStatus } from "../../lib/orders";
import { users } from "./auth";
import { companies } from "./companies";
import { conversations } from "./conversations";

// One order a customer placed in a chat (step 52), written up by ansa
// (lib/orders.ts): the dishes with the prices copied when it was written,
// ansa's total, delivery or pickup. "proposed" while the customer hasn't
// said yes to the summary (one per conversation, no number yet); numbered
// under the company row lock when they do, like tickets. The address and
// the customer's notes are encrypted (orderFieldContext).
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    conversationId: uuid("conversation_id").notNull(),
    // Per company, from 1; null while proposed.
    orderNumber: integer("order_number"),
    status: text("status").$type<OrderStatus>().notNull(),
    fulfilment: text("fulfilment").$type<Fulfilment>().notNull(),
    addressEncrypted: text("address_encrypted"),
    notesEncrypted: text("notes_encrypted"),
    // When the customer wants it, as they said it ("As soon as possible", "20:30").
    wantedTime: text("wanted_time").notNull(),
    currency: text("currency").notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
    deliveryFeeCents: integer("delivery_fee_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    // The summary the customer says yes to (a message of this conversation).
    // No foreign key: a message deleted in Telegram is deleted here too.
    summaryMessageId: uuid("summary_message_id"),
    // Who last changed its status on the Orders page (null: the customer and ansa).
    updatedByUserId: text("updated_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    placedAt: timestamp("placed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("orders_company_id_id_unique").on(table.companyId, table.id),
    unique("orders_company_number_unique").on(table.companyId, table.orderNumber),
    // One order being written up per conversation.
    uniqueIndex("orders_one_proposed_per_conversation").on(table.companyId, table.conversationId).where(sql`${table.status} = 'proposed'`),
    // The Orders page reads a company's orders by status, newest first.
    index("orders_company_status_placed_idx").on(table.companyId, table.status, table.placedAt),
    foreignKey({
      name: "orders_conversation_in_same_company_fk",
      columns: [table.companyId, table.conversationId],
      foreignColumns: [conversations.companyId, conversations.id],
    }),
    foreignKey({
      name: "orders_updater_in_same_company_fk",
      columns: [table.companyId, table.updatedByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    check("orders_status_known", sql`${table.status} IN ('proposed', 'new', 'accepted', 'ready', 'done', 'cancelled')`),
    check("orders_fulfilment_known", sql`${table.fulfilment} IN ('delivery', 'pickup')`),
    // A number and a time placed exactly once the customer said yes.
    check("orders_number_once_placed", sql`(${table.status} = 'proposed') = (${table.orderNumber} IS NULL) AND (${table.orderNumber} IS NULL) = (${table.placedAt} IS NULL)`),
    check("orders_number_positive", sql`${table.orderNumber} IS NULL OR ${table.orderNumber} > 0`),
    check("orders_address_only_for_delivery", sql`(${table.fulfilment} = 'delivery') = (${table.addressEncrypted} IS NOT NULL)`),
    check("orders_wanted_time_length", sql`char_length(${table.wantedTime}) BETWEEN 1 AND 100`),
    check("orders_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("orders_amounts_add_up", sql`${table.subtotalCents} >= 0 AND ${table.deliveryFeeCents} >= 0 AND ${table.totalCents} = ${table.subtotalCents} + ${table.deliveryFeeCents}`),
    check("orders_fee_only_for_delivery", sql`${table.fulfilment} = 'delivery' OR ${table.deliveryFeeCents} = 0`),
  ],
);

// One line of an order: a dish's name and price as the menu had them when
// the order was written up (a later menu change never changes an order).
export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").notNull(),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    lineTotalCents: integer("line_total_cents").notNull(),
  },
  (table) => [
    index("order_items_order_idx").on(table.orderId, table.position),
    // A proposal written up again replaces its lines: they go with it.
    foreignKey({
      name: "order_items_order_in_same_company_fk",
      columns: [table.companyId, table.orderId],
      foreignColumns: [orders.companyId, orders.id],
    }).onDelete("cascade"),
    check("order_items_name_length", sql`char_length(${table.name}) BETWEEN 1 AND 120`),
    check("order_items_quantity_range", sql`${table.quantity} BETWEEN 1 AND 50`),
    check("order_items_amounts", sql`${table.unitPriceCents} >= 0 AND ${table.lineTotalCents} = ${table.quantity} * ${table.unitPriceCents}`),
  ],
);
