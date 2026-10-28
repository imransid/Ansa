import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// A company is one tenant. Almost every other table points back here.
export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    // The number given to this company's most recent ticket. See createTicket.
    lastTicketNumber: integer("last_ticket_number").notNull().default(0),
    // Where customer replies to our emails should go (the Reply-To header),
    // set by an owner on the Setup page. Empty = the company's forwarding
    // address (below), so replies still come back to this company.
    replyToEmail: text("reply_to_email"),
    // The secret part of the company's forwarding address,
    // c-<token>@<INBOUND_EMAIL_DOMAIN> (lib/forwarding-address.ts). It alone
    // decides which company a received email belongs to, so only the database
    // makes it: 32 hex characters from gen_random_uuid() (122 random bits),
    // never a value anyone types. Unique, so one address = one company. ansa
    // can replace it with a new default (replaceInboundTokenForCompany).
    inboundToken: text("inbound_token")
      .notNull()
      .unique()
      .default(sql`replace(gen_random_uuid()::text, '-', '')`),
    // An owner's choice on the Co-Founder's Strategy page (step 37): whether
    // marketing plans also get the company's ticket counts per category of
    // the last 30 days (names and numbers only). Off until an owner turns
    // it on: otherwise nothing from support reaches the Co-Founder.
    cofounderUsesSupportTrends: boolean("cofounder_uses_support_trends").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Postgres refuses any other shape, so a script or a bad update can't
    // give a company a short, guessable or look-alike token.
    check("companies_inbound_token_format", sql`${table.inboundToken} ~ '^[0-9a-f]{32}$'`),
  ],
);
