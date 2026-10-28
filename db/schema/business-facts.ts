import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
// A relative path on purpose: drizzle-kit reads this file outside Next.js.
// The lists live in lib/ so the forms in the browser can read them too.
import type { BusinessFactTopic, FactConfirmationSource, FactProposalSource } from "../../lib/business-facts";
import { users } from "./auth";
import { companies } from "./companies";

// What one company knows about its own business (step 36), one row per topic
// (lib/business-facts.ts): a value an owner confirmed, and beside it a value
// the AI proposed from the interview or a knowledge article, waiting for an
// owner. A proposal NEVER overwrites a confirmed value: only an owner's
// Confirm turns it into the fact (db/business-facts.ts). Plain text on
// purpose (like knowledge articles): the company's own information about
// itself, written to be published, not customer data.
export const businessFacts = pgTable(
  "business_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    topic: text("topic").$type<BusinessFactTopic>().notNull(),
    confirmedValue: text("confirmed_value"),
    confirmedByUserId: text("confirmed_by_user_id"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedSource: text("confirmed_source").$type<FactConfirmationSource>(),
    proposedValue: text("proposed_value"),
    proposedSource: text("proposed_source").$type<FactProposalSource>(),
    proposedAt: timestamp("proposed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One row per company and topic; also what the company's reads use.
    unique("business_facts_company_id_topic_unique").on(table.companyId, table.topic),
    // Postgres refuses an owner from another company as the one who confirmed.
    foreignKey({
      name: "business_facts_confirmer_in_same_company_fk",
      columns: [table.companyId, table.confirmedByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    // The same lists as lib/business-facts.ts (a check proves they agree).
    check(
      "business_facts_topic_known",
      sql`${table.topic} IN ('company_name', 'description', 'industry', 'products', 'services', 'target_customers', 'customer_problems', 'value_proposition', 'location', 'languages', 'goals', 'brand_voice', 'marketing_channels', 'publishing_frequency', 'competitors', 'campaign_budget', 'website', 'prices', 'offers_promotions', 'policies', 'positioning', 'social_accounts', 'content_preferences', 'visual_identity', 'words_to_avoid')`,
    ),
    check("business_facts_confirmed_source_known", sql`${table.confirmedSource} IN ('interview', 'owner', 'knowledge')`),
    check("business_facts_proposed_source_known", sql`${table.proposedSource} IN ('interview', 'knowledge')`),
    // The limits of lib/cofounder/limits.ts, as a safety net under Zod.
    check("business_facts_confirmed_value_length", sql`char_length(${table.confirmedValue}) BETWEEN 1 AND 2000`),
    check("business_facts_proposed_value_length", sql`char_length(${table.proposedValue}) BETWEEN 1 AND 2000`),
    // A confirmed value always says who confirmed it, when, and from where;
    // a proposal where it came from and when. Each set all or nothing.
    check(
      "business_facts_confirmation_fields_together",
      sql`num_nonnulls(${table.confirmedValue}, ${table.confirmedByUserId}, ${table.confirmedAt}, ${table.confirmedSource}) IN (0, 4)`,
    ),
    check("business_facts_proposal_fields_together", sql`num_nonnulls(${table.proposedValue}, ${table.proposedSource}, ${table.proposedAt}) IN (0, 3)`),
  ],
);
