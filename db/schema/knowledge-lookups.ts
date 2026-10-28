import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";

// One search the voice assistant made during a live call (step 35, the Vapi
// tool search_company_knowledge): which articles it was given, never what
// was asked (that is call content). The call page lists them.
export const knowledgeLookups = pgTable(
  "knowledge_lookups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // From the phone line the call came in on, never from the payload.
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    // Vapi's id of the call, as Vapi gives it. WHY not a foreign key to
    // calls: the call's row is only saved when the call ends
    // (end-of-call-report), after its lookups. The call page matches it to
    // calls.vapi_call_id within the company.
    vapiCallId: text("vapi_call_id").notNull(),
    // The articles whose text the assistant got, best first, each once. No
    // foreign key (Postgres has none for array elements): an article deleted
    // since shows as "deleted article".
    articleIds: uuid("article_ids").array().notNull(),
    // How many pieces of text the answer held (0 = nothing found). Two
    // pieces can come from one article.
    hitCount: integer("hit_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The call page reads one call's lookups of one company, in order.
    index("knowledge_lookups_company_id_vapi_call_id_created_at_idx").on(table.companyId, table.vapiCallId, table.createdAt),
    // At most 3 pieces per answer (lib/knowledge/call-answer.ts), each from one article.
    check("knowledge_lookups_hit_count_range", sql`${table.hitCount} BETWEEN 0 AND 3`),
    check("knowledge_lookups_articles_within_hits", sql`cardinality(${table.articleIds}) <= ${table.hitCount}`),
    check("knowledge_lookups_vapi_call_id_length", sql`char_length(${table.vapiCallId}) BETWEEN 1 AND 200`),
  ],
);
