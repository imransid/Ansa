import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// A company is one tenant. Almost every other table points back here.
export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // The number given to this company's most recent ticket. See createTicket.
  lastTicketNumber: integer("last_ticket_number").notNull().default(0),
  // Where customer replies to our emails should go (the Reply-To header).
  // Empty = no Reply-To. Nothing sets it yet.
  replyToEmail: text("reply_to_email"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
