import { sql } from "drizzle-orm";
import { boolean, check, customType, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
// A relative path on purpose: drizzle-kit reads this file outside Next.js.
// The lists live in lib/ so the forms in the browser can read them too.
import type { KnowledgeKind, KnowledgeStatus } from "../../lib/knowledge/kinds";
import { users } from "./auth";
import { companies } from "./companies";
import { companyDocuments } from "./documents";
import { tickets } from "./tickets";

// Postgres's full-text search value. Drizzle has no type of its own for it.
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

// The company's own reference text (step 34): FAQs, policies, product facts,
// how-to guides, the fixes to solved problems, imported documents and web
// pages. One knowledge base per company, shared by the support AI and the
// Co-Founder, each reading only approved articles meant for it. Plain text on
// purpose (not encrypted like customer data): the company writes it for its
// customers, and Postgres must read it to search it. The forms say to keep
// customer details out.
export const knowledgeArticles = pgTable(
  "knowledge_articles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    // One plain line (lib/validation/knowledge.ts).
    title: text("title").notNull(),
    body: text("body").notNull(),
    kind: text("kind").$type<KnowledgeKind>().notNull(),
    status: text("status").$type<KnowledgeStatus>().notNull().default("draft"),
    // Who the AI may use it for. Drafts and archived articles: nobody.
    useForSupport: boolean("use_for_support").notNull().default(true),
    useForMarketing: boolean("use_for_marketing").notNull().default(false),
    // Goes up by one with every change to the text, kind or audiences. An
    // edit or an approval names the revision the person was looking at, and
    // is refused when someone changed the article since.
    revision: integer("revision").notNull().default(1),
    // Where it came from, if anywhere: an uploaded document, a solved ticket
    // ("Save as knowledge") or a web page. Deleting the document only clears
    // the reference (db/documents.ts): the article stays.
    sourceDocumentId: uuid("source_document_id"),
    sourceTicketId: uuid("source_ticket_id"),
    sourceUrl: text("source_url"),
    createdByUserId: text("created_by_user_id").notNull(),
    updatedByUserId: text("updated_by_user_id").notNull(),
    // The owner who approved the text as it is now. An owner's edit of an
    // approved article approves the new text, so it names them.
    approvedByUserId: text("approved_by_user_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Lets knowledge_chunks use a (company_id, article_id) foreign key.
    unique("knowledge_articles_company_id_id_unique").on(table.companyId, table.id),
    // Postgres refuses a source or a person from another company.
    foreignKey({
      name: "knowledge_articles_document_in_same_company_fk",
      columns: [table.companyId, table.sourceDocumentId],
      foreignColumns: [companyDocuments.companyId, companyDocuments.id],
    }),
    foreignKey({
      name: "knowledge_articles_ticket_in_same_company_fk",
      columns: [table.companyId, table.sourceTicketId],
      foreignColumns: [tickets.companyId, tickets.id],
    }),
    foreignKey({
      name: "knowledge_articles_creator_in_same_company_fk",
      columns: [table.companyId, table.createdByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    foreignKey({
      name: "knowledge_articles_updater_in_same_company_fk",
      columns: [table.companyId, table.updatedByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    foreignKey({
      name: "knowledge_articles_approver_in_same_company_fk",
      columns: [table.companyId, table.approvedByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    // The same lists as lib/knowledge/kinds.ts (a check proves they agree).
    check("knowledge_articles_kind_known", sql`${table.kind} IN ('faq', 'policy', 'product', 'guide', 'solution', 'document', 'website')`),
    check("knowledge_articles_status_known", sql`${table.status} IN ('draft', 'approved', 'archived')`),
    // The limits of lib/knowledge/limits.ts, as a safety net under Zod.
    check("knowledge_articles_title_length", sql`char_length(${table.title}) BETWEEN 1 AND 200`),
    check("knowledge_articles_body_length", sql`char_length(${table.body}) BETWEEN 1 AND 20000`),
    check(
      "knowledge_articles_source_url_https",
      sql`${table.sourceUrl} IS NULL OR (${table.sourceUrl} LIKE 'https://%' AND char_length(${table.sourceUrl}) <= 2000)`,
    ),
    check("knowledge_articles_one_source_at_most", sql`num_nonnulls(${table.sourceDocumentId}, ${table.sourceTicketId}, ${table.sourceUrl}) <= 1`),
    // Approved = an owner approved it, and when. A draft carries no approval.
    check("knowledge_articles_approval_fields_together", sql`(${table.approvedByUserId} IS NULL) = (${table.approvedAt} IS NULL)`),
    check("knowledge_articles_approved_has_approver", sql`${table.status} <> 'approved' OR ${table.approvedByUserId} IS NOT NULL`),
    check("knowledge_articles_draft_has_no_approver", sql`${table.status} <> 'draft' OR ${table.approvedByUserId} IS NULL`),
    // The Knowledge page lists one company's articles, last changed first:
    // by status ("Drafts"), and all of them.
    index("knowledge_articles_company_id_status_updated_at_idx").on(table.companyId, table.status, table.updatedAt),
    index("knowledge_articles_company_id_updated_at_idx").on(table.companyId, table.updatedAt),
    // Deleting a document clears its articles' reference.
    index("knowledge_articles_company_id_source_document_idx")
      .on(table.companyId, table.sourceDocumentId)
      .where(sql`${table.sourceDocumentId} IS NOT NULL`),
  ],
);

// What the search reads: each article cut into pieces of at most 1,500
// characters at paragraph boundaries (lib/knowledge/chunking.ts), rewritten
// in the same transaction as every change to the article's title or body.
export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    articleId: uuid("article_id").notNull(),
    // 0 for the first piece of the article.
    position: integer("position").notNull(),
    // A copy of the article's title, so a piece can be found by it too.
    heading: text("heading").notNull(),
    text: text("text").notNull(),
    // The words of the heading (weighted A, counting most) and the text (B),
    // made by Postgres itself. 'simple' on purpose: every language, no
    // stemming. Lower-cased and NFKC-normalized first with ICU's root
    // collation, the way lib/knowledge/search-query.ts writes the words
    // searched for, so "État" is found as "état" whatever locale the
    // database was created with (in a "C" database, Postgres alone only
    // lower-cases a to z).
    searchVector: tsvector("search_vector")
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('simple', lower(normalize("heading", NFKC) COLLATE "und-x-icu")), 'A') || setweight(to_tsvector('simple', lower(normalize("text", NFKC) COLLATE "und-x-icu")), 'B')`,
      ),
  },
  (table) => [
    // Postgres refuses a piece of another company's article; deleting an
    // article deletes its pieces.
    foreignKey({
      name: "knowledge_chunks_article_in_same_company_fk",
      columns: [table.companyId, table.articleId],
      foreignColumns: [knowledgeArticles.companyId, knowledgeArticles.id],
    }).onDelete("cascade"),
    unique("knowledge_chunks_article_id_position_unique").on(table.articleId, table.position),
    check("knowledge_chunks_text_length", sql`char_length(${table.text}) BETWEEN 1 AND 1600`),
    check("knowledge_chunks_position_not_negative", sql`${table.position} >= 0`),
    index("knowledge_chunks_search_vector_idx").using("gin", table.searchVector),
  ],
);
